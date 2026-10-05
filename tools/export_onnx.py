"""Export the PixelGPT 24x24 generator (by unstonio) to two ONNX graphs for in-browser inference.

condition.onnx  caption embedding + palette  ->  the per-layer adaptive-norm modulations (once per sprite)
step.onnx       one token + key/value cache  ->  logits for the next pixel and that token's keys/values

The browser keeps the key/value cache itself and passes the filled part back at every step, so each of
the 576 steps only computes one token. Usage: python tools/export_onnx.py <output_dir>
"""
from __future__ import annotations

import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from model_runtime import NUM_COLORS, load_model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


class Condition(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, caption: torch.Tensor, palette: torch.Tensor):
        # Linear layers written as MatMul + Add (instead of Gemm) so the weight quantizer can compress them.
        def linear(layer, value):
            out = value @ layer.weight.t()
            return out if layer.bias is None else out + layer.bias

        def mlp(sequential, value):
            return linear(sequential[2], F.silu(linear(sequential[0], value)))

        model = self.model
        condition = mlp(model.caption_mlp, caption) + mlp(model.palette_mlp, palette.reshape(palette.size(0), -1))
        mods = torch.stack([linear(block.ada, condition).view(-1, 6, condition.size(-1)) for block in model.blocks], dim=1)
        mod_out = linear(model.ada_out, condition).view(-1, 2, condition.size(-1))
        return mods, mod_out


class Step(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, token, position, palette, mods, mod_out, past_k, past_v, past_bias):
        # token [B,1] int64, position [1] int64, palette [B,5,3], mods [B,L,6,D], mod_out [B,2,D],
        # past_k/past_v [T,L,B,H,Dh], past_bias [T] (0 for filled slots, -1e9 for padding)
        model = self.model
        token_embedding = model.token_embedding(token)
        safe = token.clamp(0, NUM_COLORS - 1)
        colors = torch.gather(palette, 1, safe.unsqueeze(-1).expand(-1, -1, 3))
        colors = model.color_mlp(colors) * (token < NUM_COLORS).unsqueeze(-1).float()
        position_embedding = model.abs_embedding(position) + torch.cat(
            [model.row_embedding(model.rows[position]), model.col_embedding(model.cols[position])], dim=-1
        )
        hidden = token_embedding + colors + position_embedding.unsqueeze(0)
        bias = torch.cat([past_bias, torch.zeros(1, dtype=past_bias.dtype)], dim=0)
        new_keys, new_values = [], []
        for index, block in enumerate(model.blocks):
            scale1, bias1, gate1, scale2, bias2, gate2 = [mods[:, index, part].unsqueeze(1) for part in range(6)]
            normed = block.norm1(hidden) * (1 + scale1) + bias1
            attn = block.attn
            batch = normed.size(0)
            query, key, value = attn.qkv(normed).chunk(3, dim=-1)
            query = query.view(batch, 1, attn.heads, attn.head_dim).transpose(1, 2)
            key = key.view(batch, 1, attn.heads, attn.head_dim).transpose(1, 2)
            value = value.view(batch, 1, attn.heads, attn.head_dim).transpose(1, 2)
            keys = torch.cat([past_k[:, index].permute(1, 2, 0, 3), key], dim=2)
            values = torch.cat([past_v[:, index].permute(1, 2, 0, 3), value], dim=2)
            scores = query @ keys.transpose(-1, -2) / (attn.head_dim ** 0.5) + bias
            output = F.softmax(scores, dim=-1) @ values
            output = output.transpose(1, 2).reshape(batch, 1, -1)
            hidden = hidden + gate1 * attn.proj(output)
            normed = block.norm2(hidden) * (1 + scale2) + bias2
            hidden = hidden + gate2 * block.mlp(normed)
            new_keys.append(key.squeeze(2))
            new_values.append(value.squeeze(2))
        scale, shift = mod_out[:, 0].unsqueeze(1), mod_out[:, 1].unsqueeze(1)
        logits = model.head(model.norm_out(hidden) * (1 + scale) + shift)[:, -1]
        return logits, torch.stack(new_keys), torch.stack(new_values)


class GpuStep(nn.Module):
    """Variant for WebGPU: a fixed 576-slot cache that stays on the GPU between steps.

    The new key/value is written at `position` and the full cache is returned, so the browser can feed
    the output buffers straight back as the next inputs without copying them through the CPU.
    """

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, token, position, palette, mods, mod_out, cache_k, cache_v):
        # cache_k/cache_v [L,B,H,576,Dh]
        model = self.model
        slots = torch.arange(cache_k.size(3))
        write = (slots == position).view(1, 1, -1, 1)
        bias = torch.where(slots <= position, 0.0, -1e9)
        token_embedding = model.token_embedding(token)
        safe = token.clamp(0, NUM_COLORS - 1)
        colors = torch.gather(palette, 1, safe.unsqueeze(-1).expand(-1, -1, 3))
        colors = model.color_mlp(colors) * (token < NUM_COLORS).unsqueeze(-1).float()
        position_embedding = model.abs_embedding(position) + torch.cat(
            [model.row_embedding(model.rows[position]), model.col_embedding(model.cols[position])], dim=-1
        )
        hidden = token_embedding + colors + position_embedding.unsqueeze(0)
        present_k, present_v = [], []
        for index, block in enumerate(model.blocks):
            scale1, bias1, gate1, scale2, bias2, gate2 = [mods[:, index, part].unsqueeze(1) for part in range(6)]
            normed = block.norm1(hidden) * (1 + scale1) + bias1
            attn = block.attn
            batch = normed.size(0)
            query, key, value = attn.qkv(normed).chunk(3, dim=-1)
            query = query.view(batch, 1, attn.heads, attn.head_dim).transpose(1, 2)
            key = key.view(batch, 1, attn.heads, attn.head_dim).transpose(1, 2)
            value = value.view(batch, 1, attn.heads, attn.head_dim).transpose(1, 2)
            keys = torch.where(write, key, cache_k[index])
            values = torch.where(write, value, cache_v[index])
            scores = query @ keys.transpose(-1, -2) / (attn.head_dim ** 0.5) + bias
            output = F.softmax(scores, dim=-1) @ values
            output = output.transpose(1, 2).reshape(batch, 1, -1)
            hidden = hidden + gate1 * attn.proj(output)
            normed = block.norm2(hidden) * (1 + scale2) + bias2
            hidden = hidden + gate2 * block.mlp(normed)
            present_k.append(keys)
            present_v.append(values)
        scale, shift = mod_out[:, 0].unsqueeze(1), mod_out[:, 1].unsqueeze(1)
        logits = model.head(model.norm_out(hidden) * (1 + scale) + shift)[:, -1]
        return logits, torch.stack(present_k), torch.stack(present_v)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "onnx")
    out.mkdir(parents=True, exist_ok=True)
    model, config, flat = load_model(str(ROOT / "models" / "pixelar_fp16.pt"), torch.device("cpu"))
    model = model.float().eval()
    layers, heads, head_dim, dim = config.layers, config.heads, config.dim // config.heads, config.dim
    batch = 2
    caption = torch.randn(batch, 384)
    palette = torch.rand(batch, NUM_COLORS, 3)
    with torch.no_grad():
        torch.onnx.export(
            Condition(model), (caption, palette), out / "condition.onnx",
            input_names=["caption", "palette"], output_names=["mods", "mod_out"],
            dynamic_axes={"caption": {0: "batch"}, "palette": {0: "batch"}, "mods": {0: "batch"}, "mod_out": {0: "batch"}},
            opset_version=17, dynamo=False,
        )
        mods, mod_out = Condition(model)(caption, palette)
        past = torch.zeros(3, layers, batch, heads, head_dim)
        inputs = (
            torch.full((batch, 1), 5, dtype=torch.long), torch.tensor([3]), palette, mods, mod_out,
            past, past.clone(), torch.zeros(3),
        )
        torch.onnx.export(
            Step(model), inputs, out / "step.onnx",
            input_names=["token", "position", "palette", "mods", "mod_out", "past_k", "past_v", "past_bias"],
            output_names=["logits", "new_k", "new_v"],
            dynamic_axes={
                "token": {0: "batch"}, "palette": {0: "batch"}, "mods": {0: "batch"}, "mod_out": {0: "batch"},
                "past_k": {0: "past", 2: "batch"}, "past_v": {0: "past", 2: "batch"}, "past_bias": {0: "past"},
                "logits": {0: "batch"}, "new_k": {1: "batch"}, "new_v": {1: "batch"},
            },
            opset_version=17, dynamo=False,
        )
        cache = torch.zeros(layers, batch, heads, 576, head_dim)
        torch.onnx.export(
            GpuStep(model), (inputs[0], inputs[1], palette, mods, mod_out, cache, cache.clone()), out / "step_gpu.onnx",
            input_names=["token", "position", "palette", "mods", "mod_out", "cache_k", "cache_v"],
            output_names=["logits", "present_k", "present_v"],
            dynamic_axes={"token": {0: "batch"}, "palette": {0: "batch"}, "mods": {0: "batch"}, "mod_out": {0: "batch"},
                          "cache_k": {1: "batch"}, "cache_v": {1: "batch"}, "logits": {0: "batch"},
                          "present_k": {1: "batch"}, "present_v": {1: "batch"}},
            opset_version=17, dynamo=False,
        )
    (out / "scan_order.json").write_text(str(flat.tolist()))
    # Unconditional caption used for classifier-free guidance.
    (out / "null_caption.json").write_text(str([round(v, 6) for v in model.null_caption.detach().float().tolist()]))
    print("exported to", out)


if __name__ == "__main__":
    main()
