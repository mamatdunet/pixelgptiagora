// Text layers with 90s WordArt effects. The same renderer draws the screen canvas, the 300 dpi export
// and the style previews, so what people see is what gets printed.
const WordArt = (() => {
  const FONTS = [
    { id: 'Anton', label: 'Anton (IAgora)', stack: '"Anton", Impact, sans-serif' },
    { id: 'Heebo', label: 'Heebo (IAgora)', stack: '"Heebo", Arial, sans-serif' },
    { id: 'Press Start 2P', label: 'Press Start (pixel)', stack: '"Press Start 2P", monospace' },
    { id: 'Bangers', label: 'Bangers (BD)', stack: '"Bangers", Impact, sans-serif' },
    { id: 'Lobster', label: 'Lobster', stack: '"Lobster", cursive' },
    { id: 'Pacifico', label: 'Pacifico', stack: '"Pacifico", cursive' },
    { id: 'Impact', label: 'Impact', stack: 'Impact, "Anton", sans-serif' },
    { id: 'Comic Sans MS', label: 'Comic Sans', stack: '"Comic Sans MS", "Chalkboard SE", cursive' },
    { id: 'Georgia', label: 'Georgia', stack: 'Georgia, serif' },
    { id: 'Courier New', label: 'Courier', stack: '"Courier New", monospace' }
  ];
  const STYLES = [
    { id: 'uni', label: 'Uni' }, { id: 'arcenciel', label: 'Arc-en-ciel' }, { id: 'or', label: 'Or' },
    { id: 'chrome', label: 'Chrome' }, { id: 'neon', label: 'Néon' }, { id: 'relief', label: 'Relief 3D' },
    { id: 'bd', label: 'BD' }, { id: 'feu', label: 'Feu' }, { id: 'iagora', label: 'IAgora' }
  ];
  const SHAPES = [
    { id: 'droit', label: 'Droit' }, { id: 'arche', label: 'Arche' },
    { id: 'sourire', label: 'Sourire' }, { id: 'vague', label: 'Vague' }
  ];
  const measureContext = document.createElement('canvas').getContext('2d');

  function fontString(item, size) {
    const font = FONTS.find(entry => entry.id === item.font) || FONTS[0];
    return `${item.italic ? 'italic ' : ''}${item.bold ? 700 : 400} ${size}px ${font.stack}`;
  }

  // One entry per character: its centre on the baseline and its rotation, following the chosen shape.
  function layoutGlyphs(item, size) {
    measureContext.font = fontString(item, size);
    const lineHeight = size * 1.2;
    const glyphs = [];
    (item.text || ' ').split('\n').forEach((line, row) => {
      const chars = Array.from(line || ' ');
      const widths = chars.map(char => measureContext.measureText(char).width);
      const total = widths.reduce((sum, width) => sum + width, 0);
      const baseline = row * lineHeight;
      const radius = Math.max(total * 0.8, size * 2.5);
      const wave = Math.PI * 2 / (size * 4);
      let cursor = -total / 2;
      chars.forEach((char, index) => {
        const width = widths[index];
        const along = cursor + width / 2;
        cursor += width;
        let x = along;
        let y = baseline;
        let angle = 0;
        if (item.shape === 'arche' || item.shape === 'sourire') {
          const sign = item.shape === 'arche' ? 1 : -1;
          const theta = along / radius;
          x = radius * Math.sin(theta);
          y = baseline + sign * radius * (1 - Math.cos(theta));
          angle = sign * theta;
        } else if (item.shape === 'vague') {
          y = baseline + Math.sin(along * wave) * size * 0.3;
          angle = Math.atan(Math.cos(along * wave) * size * 0.3 * wave);
        }
        glyphs.push({ char, x, y, angle, width });
      });
    });
    return glyphs;
  }

  function darken(hex, factor) {
    const value = parseInt(hex.slice(1), 16);
    const channel = shift => Math.round(((value >> shift) & 255) * factor);
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  function render(item, scale = 1) {
    const size = Math.max(2, item.fontSize * scale);
    const glyphs = layoutGlyphs(item, size);
    const ascent = size * 0.95;
    const descent = size * 0.3;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    glyphs.forEach(glyph => {
      const cos = Math.cos(glyph.angle);
      const sin = Math.sin(glyph.angle);
      [[-glyph.width / 2, -ascent], [glyph.width / 2, -ascent], [-glyph.width / 2, descent], [glyph.width / 2, descent]]
        .forEach(([dx, dy]) => {
          const x = glyph.x + dx * cos - dy * sin;
          const y = glyph.y + dx * sin + dy * cos;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        });
    });
    const pad = size * 0.5;
    const width = Math.ceil(maxX - minX + pad * 2);
    const height = Math.ceil(maxY - minY + pad * 2);
    const originX = pad - minX;
    const originY = pad - minY;
    const top = pad;
    const bottom = height - pad;

    const layer = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    const drawGlyphs = (context, stroke) => {
      context.font = fontString(item, size);
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.lineJoin = 'round';
      glyphs.forEach(glyph => {
        context.save();
        context.translate(originX + glyph.x, originY + glyph.y);
        context.rotate(glyph.angle);
        if (stroke) context.strokeText(glyph.char, 0, 0);
        context.fillText(glyph.char, 0, 0);
        if (item.underline) {
          const thickness = Math.max(1, size * 0.07);
          context.fillRect(-glyph.width / 2 - 0.5, size * 0.12, glyph.width + 1, thickness);
          if (stroke) context.strokeRect(-glyph.width / 2 - 0.5, size * 0.12, glyph.width + 1, thickness);
        }
        context.restore();
      });
    };
    // A layer with the glyphs filled (and optionally outlined) in one colour.
    const solid = (color, outline = 0) => {
      const canvas = layer();
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.strokeStyle = color;
      context.lineWidth = outline * size;
      drawGlyphs(context, outline > 0);
      return canvas;
    };
    // The glyphs filled with a gradient that spans the whole text, not each letter.
    const painted = (direction, stops) => {
      const canvas = solid('#000');
      const context = canvas.getContext('2d');
      const gradient = direction === 'horizontal'
        ? context.createLinearGradient(pad, 0, width - pad, 0)
        : context.createLinearGradient(0, top, 0, bottom);
      stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      return canvas;
    };

    const output = layer();
    const out = output.getContext('2d');
    const draw = (canvas, dx = 0, dy = 0) => out.drawImage(canvas, dx, dy);
    const glow = (canvas, color, blur, times = 1) => {
      out.save();
      out.shadowColor = color;
      out.shadowBlur = blur * size;
      for (let index = 0; index < times; index++) draw(canvas);
      out.restore();
    };
    const extrude = (color, depth, outline = 0) => {
      const slab = solid(color, outline);
      const steps = Math.max(1, Math.round(depth * size));
      for (let step = steps; step > 0; step--) draw(slab, step, step);
    };

    const color = item.color || '#3045D1';
    switch (item.style) {
      case 'arcenciel':
        draw(solid('rgba(0, 0, 0, .3)', 0.12), size * 0.07, size * 0.07);
        draw(solid('#14141A', 0.12));
        draw(painted('horizontal', [[0, '#e40303'], [0.2, '#ff8c00'], [0.4, '#ffed00'], [0.6, '#008026'], [0.8, '#004dff'], [1, '#750787']]));
        break;
      case 'or':
        extrude('#7a4b00', 0.08, 0.08);
        draw(solid('#5a3a00', 0.08));
        draw(painted('vertical', [[0, '#fff7c2'], [0.45, '#f7c948'], [0.55, '#c8901a'], [1, '#ffe58a']]));
        break;
      case 'chrome':
        draw(solid('rgba(0, 0, 0, .3)', 0.1), size * 0.06, size * 0.06);
        draw(solid('#1d2230', 0.1));
        draw(painted('vertical', [[0, '#ffffff'], [0.48, '#aab2c5'], [0.5, '#2b3040'], [0.53, '#59617a'], [1, '#e8edf7']]));
        break;
      case 'neon':
        glow(solid(color), color, 0.35, 2);
        draw(solid(color, 0.07));
        draw(solid('#ffffff'));
        break;
      case 'relief':
        extrude(darken(color, 0.55), 0.12);
        draw(solid('#14141A', 0.03));
        draw(solid(color));
        break;
      case 'bd': {
        const outline = solid('#14141A', 0.16);
        draw(outline, size * 0.09, size * 0.09);
        draw(outline);
        draw(painted('vertical', [[0, '#fff27a'], [1, '#ffc21a']]));
        break;
      }
      case 'feu':
        glow(solid('#ff6a00'), '#ff6a00', 0.3, 2);
        draw(solid('#7a1000', 0.06));
        draw(painted('vertical', [[0, '#fff6a0'], [0.5, '#ffa000'], [1, '#e1251b']]));
        break;
      case 'iagora':
        glow(solid('#ffffff', 0.12), 'rgba(48, 69, 209, .35)', 0.3);
        draw(painted('horizontal', [[0, '#FF50BE'], [1, '#3045D1']]));
        break;
      default:
        draw(solid(color));
    }
    return { canvas: output, width: width / scale, height: height / scale };
  }

  return { FONTS, STYLES, SHAPES, render, fontString };
})();
