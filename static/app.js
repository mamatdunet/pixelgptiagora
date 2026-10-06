const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const stage = document.querySelector('#stage');
const form = document.querySelector('#promptForm');
const promptInput = document.querySelector('#prompt');
const generateButton = document.querySelector('#generateButton');
const status = document.querySelector('#status');
const emptyState = document.querySelector('#emptyState');
const inspector = document.querySelector('#inspector');
const textInspector = document.querySelector('#textInspector');
const selectedName = document.querySelector('#selectedName');
const paletteElement = document.querySelector('#palette');
const layersPanel = document.querySelector('#layersPanel');
const layersElement = document.querySelector('#layers');
const regenerateButton = document.querySelector('#regenerateButton');
const randomPaletteButton = document.querySelector('#randomPaletteButton');
const temperatureInput = document.querySelector('#temperature');
const temperatureValue = document.querySelector('#temperatureValue');
const undoButton = document.querySelector('#undoButton');
const redoButton = document.querySelector('#redoButton');
const historyPanel = document.querySelector('#historyPanel');
const historyElement = document.querySelector('#history');
const groupButton = document.querySelector('#groupButton');
const ungroupButton = document.querySelector('#ungroupButton');
const examplesElement = document.querySelector('#examples');
const landscapeButton = document.querySelector('#landscapeButton');
const portraitButton = document.querySelector('#portraitButton');
const cardBackgroundInput = document.querySelector('#cardBackground');
const library = document.querySelector('#library');
const libraryTabs = document.querySelector('#libraryTabs');
const libraryGrid = document.querySelector('#libraryGrid');
const libraryHint = document.querySelector('#libraryHint');
const librarySearch = document.querySelector('#librarySearch');
const printImage = document.querySelector('#printImage');
const textContent = document.querySelector('#textContent');
const textFont = document.querySelector('#textFont');
const textColor = document.querySelector('#textColor');
const textSize = document.querySelector('#textSize');
const textStyles = document.querySelector('#textStyles');
const textShapes = document.querySelector('#textShapes');
const formatToggles = { bold: '#textBold', italic: '#textItalic', underline: '#textUnderline' };
const publishDialog = document.querySelector('#publishDialog');
const publishForm = document.querySelector('#publishForm');
const publishPreview = document.querySelector('#publishPreview');
const publishStatus = document.querySelector('#publishStatus');
const publishSubmit = document.querySelector('#publishSubmit');

// Printable postcard: 15 x 10 cm, exported at 300 dpi.
const CARD_MM = { landscape: [150, 100], portrait: [100, 150] };
const PRINT_DPI = 300;
const EXAMPLES = [
  'grenouille verte', 'chouette des neiges', 'fantôme', 'chevalier en armure', 'sorcière', 'champignon rouge',
  'tasse de café', 'coffre au trésor', 'potion magique', 'clé ancienne', 'bougie allumée', 'robot', 'phare', 'maison en bois'
];
const SCREEN_SCALE = Math.min(window.devicePixelRatio || 1, 2);
let cardOrientation = 'landscape';
let cardBackground = '#ffffff';
let card = null;
let libraryData = null;
let compositions = null;

// Layers are pixel sprites ({ tokens, palette, pixelSize }) or text ({ type: 'text', text, font, fontSize, … }).
const sprites = [];
const selectedIds = new Set();
let primaryId = null;
let drag = null;
let nextId = 1;
let nextGroupId = 1;
let isGenerating = false;
const undoStack = [];
const redoStack = [];
const HISTORY_LIMIT = 50;

const isText = item => item?.type === 'text';

// Everything except caches and animation handles, deep-copied so later edits cannot leak into history.
function serializeItem(item) {
  const { bitmap, bitmapDirty, dropFrame, rendering, ...data } = item;
  return structuredClone(data);
}

function captureState() {
  return {
    sprites: sprites.map(serializeItem),
    selectedIds: [...selectedIds], primaryId, nextId, nextGroupId, cardOrientation, cardBackground
  };
}

function restoreState(state) {
  sprites.forEach(sprite => {
    if (sprite.dropFrame) cancelAnimationFrame(sprite.dropFrame);
  });
  sprites.splice(0, sprites.length, ...state.sprites.map(item => ({ ...structuredClone(item), bitmapDirty: true })));
  selectedIds.clear();
  state.selectedIds.forEach(id => selectedIds.add(id));
  primaryId = state.primaryId;
  nextId = state.nextId;
  nextGroupId = state.nextGroupId;
  cardOrientation = state.cardOrientation;
  cardBackground = state.cardBackground;
  card = computeCard();
  renderUI();
  draw();
  scheduleDraftSave();
}

function commitHistory(label, before) {
  undoStack.push({ label, state: before });
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  renderHistory();
  scheduleDraftSave();
}

// --- Draft: the card is kept in this browser so a reload, a stray link or the Back button never loses work.

const DRAFT_KEY = 'iagora-atelier-brouillon';
let draftTimer = null;

// Positions are stored relative to the card and sizes relative to its height, so the draft
// comes back in the right place even if the window size changed.
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!card) return;
  try {
    if (!sprites.length) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const items = sprites.map(item => ({
      ...serializeItem(item), x: (item.x - card.x) / card.w, y: (item.y - card.y) / card.h
    }));
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1, savedAt: Date.now(), cardOrientation, cardBackground, cardHeight: card.h, nextId, nextGroupId, items
    }));
  } catch {
    // Storage blocked or full: the draft is a safety net, editing keeps working without it.
  }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 300);
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return;
  }
  if (draft?.version !== 1 || !Array.isArray(draft.items) || !draft.items.length) return;
  cardOrientation = draft.cardOrientation === 'portrait' ? 'portrait' : 'landscape';
  cardBackground = /^#[0-9a-f]{6}$/i.test(draft.cardBackground) ? draft.cardBackground : '#ffffff';
  card = computeCard();
  const factor = card.h / draft.cardHeight;
  sprites.splice(0, sprites.length, ...draft.items.map(item => {
    const restored = { ...item, x: card.x + item.x * card.w, y: card.y + item.y * card.h, bitmapDirty: true };
    if (isText(item)) restored.fontSize = Math.max(8, Math.round(item.fontSize * factor));
    else restored.pixelSize = Math.max(2, Math.min(24, Math.round(item.pixelSize * factor)));
    return restored;
  }));
  nextId = Math.max(draft.nextId, ...sprites.map(item => item.id + 1));
  nextGroupId = draft.nextGroupId;
  const savedAt = new Date(draft.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  status.textContent = `Votre carte en cours a été retrouvée (enregistrée à ${savedAt}). « Effacer » pour repartir de zéro.`;
}

// Last-chance save when the page is left, reloaded or hidden (covers typing that was not committed yet).
window.addEventListener('pagehide', saveDraft);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveDraft();
});

function undo() {
  if (isGenerating) return;
  const entry = undoStack.pop();
  if (!entry) return;
  redoStack.push({ label: entry.label, state: captureState() });
  restoreState(entry.state);
  status.textContent = `Annulé : ${entry.label.toLowerCase()}`;
}

function redo() {
  if (isGenerating) return;
  const entry = redoStack.pop();
  if (!entry) return;
  undoStack.push({ label: entry.label, state: captureState() });
  restoreState(entry.state);
  status.textContent = `Rétabli : ${entry.label.toLowerCase()}`;
}

function renderHistory() {
  undoButton.disabled = !undoStack.length || isGenerating;
  redoButton.disabled = !redoStack.length || isGenerating;
  historyPanel.hidden = !undoStack.length && !redoStack.length;
  historyElement.replaceChildren();
  redoStack.slice().reverse().forEach(entry => {
    const row = document.createElement('div');
    row.className = 'history-entry undone';
    row.textContent = `${entry.label} (annulé)`;
    historyElement.append(row);
  });
  undoStack.slice(-12).reverse().forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = `history-entry${index === 0 ? ' latest' : ''}`;
    row.textContent = entry.label;
    historyElement.append(row);
  });
}

function idsForSprite(sprite) {
  if (sprite?.groupId == null) return sprite ? [sprite.id] : [];
  return sprites.filter(item => item.groupId === sprite.groupId).map(item => item.id);
}

function selectedSprite() {
  return sprites.find(sprite => sprite.id === primaryId) || null;
}

function selectedSprites() {
  return sprites.filter(sprite => selectedIds.has(sprite.id));
}

function itemName(item) {
  return isText(item) ? `« ${item.text.replace(/\s+/g, ' ').trim() || '…'} »` : item.name;
}

// --- Geometry

function resizeCanvas() {
  canvas.width = Math.round(innerWidth * SCREEN_SCALE);
  canvas.height = Math.round(innerHeight * SCREEN_SCALE);
  ctx.setTransform(SCREEN_SCALE, 0, 0, SCREEN_SCALE, 0, 0);
  layoutCard();
  renderUI();
  draw();
}

// The card is the largest 3:2 (or 2:3) rectangle that fits between the header, the creation bar and the side panels.
function computeCard() {
  const [widthMm, heightMm] = CARD_MM[cardOrientation];
  const top = innerWidth <= 1100 ? 128 : 92;
  const bottom = innerWidth <= 700 ? 150 : 124;
  const side = innerWidth > 1180 ? 290 : 16;
  const availableWidth = Math.max(120, innerWidth - side * 2);
  const availableHeight = Math.max(120, innerHeight - top - bottom);
  const width = Math.min(availableWidth, availableHeight * widthMm / heightMm);
  const height = width * heightMm / widthMm;
  return {
    x: Math.round((innerWidth - width) / 2), y: Math.round(top + (availableHeight - height) / 2),
    w: Math.round(width), h: Math.round(height)
  };
}

function itemBox(item) {
  if (isText(item)) {
    const rendering = textRendering(item);
    return { x: item.x, y: item.y, w: rendering.width, h: rendering.height };
  }
  const side = item.pixelSize * 24;
  return { x: item.x, y: item.y, w: side, h: side };
}

// Apply a change to an item while keeping its centre where it was (text boxes change size with their content).
function keepCenter(item, change) {
  const before = itemBox(item);
  change();
  const after = itemBox(item);
  item.x += (before.w - after.w) / 2;
  item.y += (before.h - after.h) / 2;
}

// Recompute the card and keep every layer at the same relative spot on it.
function layoutCard() {
  const previous = card;
  card = computeCard();
  if (!previous) return;
  sprites.forEach(item => {
    const box = itemBox(item);
    item.x = card.x + (item.x + box.w / 2 - previous.x) / previous.w * card.w - box.w / 2;
    item.y = card.y + (item.y + box.h / 2 - previous.y) / previous.h * card.h - box.h / 2;
  });
}

function setOrientation(orientation) {
  if (orientation === cardOrientation) return;
  const before = captureState();
  cardOrientation = orientation;
  layoutCard();
  commitHistory(orientation === 'landscape' ? 'Carte en paysage' : 'Carte en portrait', before);
  renderUI();
  draw();
}

function spawnPlacement() {
  const pixelSize = Math.max(2, Math.round(card.h * 0.3 / 24));
  const side = pixelSize * 24;
  const offset = (sprites.length % 5) * 20 - 40;
  return {
    pixelSize,
    x: card.x + (card.w - side) / 2 + offset,
    y: card.y + (card.h - side) / 2 + offset / 2
  };
}

// --- Rendering

function spriteBitmap(sprite) {
  if (!sprite.bitmap || sprite.bitmapDirty) {
    sprite.bitmap ||= document.createElement('canvas');
    sprite.bitmap.width = 24;
    sprite.bitmap.height = 24;
    const bitmapContext = sprite.bitmap.getContext('2d');
    bitmapContext.clearRect(0, 0, 24, 24);
    for (let index = 0; index < sprite.tokens.length; index++) {
      const role = sprite.tokens[index];
      if (role === sprite.transparentIndex) continue;
      bitmapContext.fillStyle = sprite.palette[role];
      bitmapContext.fillRect(index % 24, Math.floor(index / 24), 1, 1);
    }
    sprite.bitmapDirty = false;
  }
  return sprite.bitmap;
}

// Text is rendered once per change (at screen resolution) and cached on the item.
function textRendering(item) {
  const key = JSON.stringify([item.text, item.font, item.fontSize, item.bold, item.italic, item.underline,
    item.color, item.style, item.shape, fontsVersion]);
  if (!item.rendering || item.rendering.key !== key) item.rendering = { ...WordArt.render(item, SCREEN_SCALE), key };
  return item.rendering;
}

function drawItem(item) {
  if (isText(item)) {
    const rendering = textRendering(item);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(rendering.canvas, item.x, item.y, rendering.width, rendering.height);
    return;
  }
  const side = item.pixelSize * 24;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteBitmap(item), Math.round(item.x), Math.round(item.y), side, side);
}

function drawCardFrame() {
  // Veil everything outside the printable area, then outline it.
  ctx.fillStyle = 'rgba(242, 242, 246, .86)';
  ctx.fillRect(0, 0, innerWidth, card.y);
  ctx.fillRect(0, card.y + card.h, innerWidth, innerHeight - card.y - card.h);
  ctx.fillRect(0, card.y, card.x, card.h);
  ctx.fillRect(card.x + card.w, card.y, innerWidth - card.x - card.w, card.h);
  ctx.strokeStyle = '#8A8A95';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(card.x - .5, card.y - .5, card.w + 1, card.h + 1);
  ctx.setLineDash([]);
  const [widthMm, heightMm] = CARD_MM[cardOrientation];
  ctx.fillStyle = '#FF50BE';
  ctx.font = '600 11px Heebo, Arial, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`ZONE IMPRIMÉE · ${widthMm / 10} × ${heightMm / 10} CM`, card.x, card.y - 8);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function draw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.save();
  ctx.shadowColor = 'rgba(20, 20, 26, .10)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = cardBackground;
  ctx.fillRect(card.x, card.y, card.w, card.h);
  ctx.restore();
  sprites.forEach(drawItem);
  drawCardFrame();
  const selection = selectedSprites();
  selection.forEach(selected => {
    const box = itemBox(selected);
    strokeDashedRect(Math.round(box.x) - 4.5, Math.round(box.y) - 4.5, Math.round(box.w) + 9, Math.round(box.h) + 9, 3);
  });
  if (selection.length === 1) {
    const box = itemBox(selection[0]);
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(box.x + box.w) + 1, Math.round(box.y + box.h) + 1, 9, 9);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(box.x + box.w) + 2, Math.round(box.y + box.h) + 2, 7, 7);
  }
  if (drag?.mode === 'marquee') {
    const left = Math.min(drag.startX, drag.currentX);
    const top = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    ctx.fillStyle = 'rgba(48, 69, 209, .06)';
    ctx.fillRect(left, top, width, height);
    strokeDashedRect(left + .5, top + .5, width, height, 4);
  }
}

// Alternating white and black dashes stay visible on any background: white shows on dark, black on light.
function strokeDashedRect(x, y, width, height, dash) {
  ctx.lineWidth = 1;
  ctx.setLineDash([dash, dash]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineDashOffset = 0;
  ctx.strokeRect(x, y, width, height);
  ctx.strokeStyle = '#000000';
  ctx.lineDashOffset = dash;
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

function animateDrop(sprite, targetY) {
  const started = performance.now();
  const from = sprite.y;
  function frame(now) {
    const progress = Math.min(1, (now - started) / 480);
    const eased = 1 - Math.pow(1 - progress, 3);
    sprite.y = from + (targetY - from) * eased;
    draw();
    if (progress < 1) sprite.dropFrame = requestAnimationFrame(frame);
    else sprite.dropFrame = null;
  }
  sprite.dropFrame = requestAnimationFrame(frame);
}

function rgbToHex(rgb) {
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function escapeHTML(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

// --- Panels

function renderUI() {
  const selected = selectedSprite();
  const selection = selectedSprites();
  emptyState.hidden = sprites.length > 0;
  emptyState.style.left = `${card.x + card.w / 2}px`;
  emptyState.style.top = `${card.y + card.h / 2}px`;
  emptyState.classList.toggle('on-dark', luminance(cardBackground) < 0.5);
  emptyState.classList.toggle('compact', card.h < 420);
  emptyState.style.maxWidth = `${card.w - 24}px`;
  landscapeButton.setAttribute('aria-pressed', String(cardOrientation === 'landscape'));
  portraitButton.setAttribute('aria-pressed', String(cardOrientation === 'portrait'));
  cardBackgroundInput.value = cardBackground;
  layersPanel.hidden = sprites.length < 2;
  inspector.hidden = !selected || isText(selected);
  textInspector.hidden = !isText(selected);
  groupButton.disabled = selection.length < 2;
  ungroupButton.disabled = !selection.some(sprite => sprite.groupId != null);
  renderHistory();

  layersElement.replaceChildren();
  [...sprites].reverse().forEach((sprite, reverseIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `layer${selectedIds.has(sprite.id) ? ' selected' : ''}`;
    const groupLabel = sprite.groupId == null ? '' : ` · G${sprite.groupId}`;
    button.innerHTML = `<span>${escapeHTML(itemName(sprite))}</span><small>${sprites.length - reverseIndex}${groupLabel}</small>`;
    button.addEventListener('click', event => select(sprite.id, event.shiftKey || event.metaKey || event.ctrlKey));
    layersElement.append(button);
  });

  if (!selected) return;
  if (isText(selected)) {
    renderTextInspector(selected);
    return;
  }
  const spriteSelection = selection.filter(item => !isText(item));
  selectedName.textContent = selection.length > 1 ? `${selection.length} objets` : selected.name;
  regenerateButton.disabled = selection.length !== 1 || isGenerating;
  paletteElement.replaceChildren();
  selected.palette.slice(1).forEach((color, visibleIndex) => {
    const label = document.createElement('label');
    label.className = 'color-control';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = color;
    input.setAttribute('aria-label', `Couleur ${visibleIndex + 1}`);
    let colorBefore = null;
    input.addEventListener('pointerdown', () => { colorBefore = captureState(); });
    input.addEventListener('focus', () => { colorBefore ||= captureState(); });
    input.addEventListener('input', () => {
      spriteSelection.forEach(sprite => {
        sprite.palette[visibleIndex + 1] = input.value;
        sprite.bitmapDirty = true;
      });
      draw();
    });
    input.addEventListener('change', () => {
      commitHistory('Changer une couleur', colorBefore || captureState());
      colorBefore = null;
    });
    const number = document.createElement('span');
    number.textContent = String(visibleIndex + 1).padStart(2, '0');
    label.append(input, number);
    paletteElement.append(label);
  });
}

function select(id, additive = false) {
  if (id == null) {
    selectedIds.clear();
    primaryId = null;
  } else if (additive) {
    const ids = idsForSprite(sprites.find(sprite => sprite.id === id));
    if (ids.every(memberId => selectedIds.has(memberId))) {
      ids.forEach(memberId => selectedIds.delete(memberId));
      if (ids.includes(primaryId)) primaryId = [...selectedIds].at(-1) ?? null;
    } else {
      ids.forEach(memberId => selectedIds.add(memberId));
      primaryId = id;
    }
  } else {
    selectedIds.clear();
    idsForSprite(sprites.find(sprite => sprite.id === id)).forEach(memberId => selectedIds.add(memberId));
    primaryId = id;
  }
  renderUI();
  draw();
}

// --- Pointer interaction

function hitTest(x, y) {
  for (let index = sprites.length - 1; index >= 0; index--) {
    const item = sprites[index];
    if (isText(item)) {
      const box = itemBox(item);
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return item;
      continue;
    }
    const localX = Math.floor((x - item.x) / item.pixelSize);
    const localY = Math.floor((y - item.y) / item.pixelSize);
    if (localX >= 0 && localX < 24 && localY >= 0 && localY < 24) {
      const role = item.tokens[localY * 24 + localX];
      if (role !== item.transparentIndex) return item;
    }
  }
  return null;
}

function hitsResizeHandle(item, x, y) {
  if (!item) return false;
  const box = itemBox(item);
  return Math.abs(x - (box.x + box.w + 5)) <= 13 && Math.abs(y - (box.y + box.h + 5)) <= 13;
}

stage.addEventListener('pointerdown', event => {
  if (event.target !== canvas) return;
  document.activeElement?.blur();
  const selected = selectedSprite();
  if (selectedIds.size === 1 && hitsResizeHandle(selected, event.clientX, event.clientY)) {
    const box = itemBox(selected);
    drag = {
      mode: 'resize', sprite: selected, before: captureState(), changed: false,
      startWidth: box.w, startFontSize: selected.fontSize
    };
    stage.classList.add('dragging');
    stage.setPointerCapture(event.pointerId);
    return;
  }
  const sprite = hitTest(event.clientX, event.clientY);
  if (!sprite) {
    drag = {
      mode: 'marquee',
      startX: event.clientX, startY: event.clientY,
      currentX: event.clientX, currentY: event.clientY,
      additive: event.shiftKey || event.metaKey || event.ctrlKey
    };
    stage.setPointerCapture(event.pointerId);
    return;
  }
  const additive = event.shiftKey || event.metaKey || event.ctrlKey;
  if (additive) {
    select(sprite.id, true);
    return;
  }
  if (!selectedIds.has(sprite.id)) select(sprite.id);
  const selection = selectedSprites();
  selection.forEach(item => {
    if (item.dropFrame) {
      cancelAnimationFrame(item.dropFrame);
      item.dropFrame = null;
    }
  });
  drag = {
    mode: 'move',
    startX: event.clientX,
    startY: event.clientY,
    before: captureState(),
    changed: false,
    positions: selection.map(item => ({ sprite: item, x: item.x, y: item.y }))
  };
  if (!selection.length) {
    select(sprite.id);
    return;
  }
  stage.classList.add('dragging');
  stage.setPointerCapture(event.pointerId);
});

stage.addEventListener('pointermove', event => {
  if (!drag) return;
  if (drag.mode === 'resize') {
    const item = drag.sprite;
    if (isText(item)) {
      const requestedWidth = Math.max(20, event.clientX - item.x);
      const fontSize = Math.max(8, Math.min(600, Math.round(drag.startFontSize * requestedWidth / drag.startWidth)));
      drag.changed ||= fontSize !== item.fontSize;
      item.fontSize = fontSize;
    } else {
      const requestedSide = Math.max(event.clientX - item.x, event.clientY - item.y);
      const size = Math.max(2, Math.min(24, Math.round(requestedSide / 24)));
      drag.changed ||= size !== item.pixelSize;
      item.pixelSize = size;
    }
  } else if (drag.mode === 'move') {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.changed ||= dx !== 0 || dy !== 0;
    drag.positions.forEach(position => {
      position.sprite.x = position.x + dx;
      position.sprite.y = position.y + dy;
    });
  } else if (drag.mode === 'marquee') {
    drag.currentX = event.clientX;
    drag.currentY = event.clientY;
  }
  draw();
});

function endDrag(event) {
  if (!drag) return;
  if (drag.mode === 'marquee') {
    const left = Math.min(drag.startX, drag.currentX);
    const right = Math.max(drag.startX, drag.currentX);
    const top = Math.min(drag.startY, drag.currentY);
    const bottom = Math.max(drag.startY, drag.currentY);
    const moved = right - left > 3 || bottom - top > 3;
    if (!drag.additive) selectedIds.clear();
    if (moved) {
      sprites.forEach(item => {
        const box = itemBox(item);
        if (box.x < right && box.x + box.w > left && box.y < bottom && box.y + box.h > top) {
          idsForSprite(item).forEach(id => selectedIds.add(id));
          primaryId = item.id;
        }
      });
    } else if (!drag.additive) {
      primaryId = null;
    }
    if (!selectedIds.size) primaryId = null;
  }
  if (drag.changed) commitHistory(drag.mode === 'move' ? 'Déplacer' : 'Redimensionner', drag.before);
  drag = null;
  stage.classList.remove('dragging');
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  renderUI();
  draw();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// --- Generation

async function generateSprite(prompt, existing = null) {
  if (isGenerating) return;
  const before = captureState();
  isGenerating = true;
  generateButton.disabled = true;
  regenerateButton.disabled = true;
  status.textContent = `Création de « ${existing?.name ?? prompt} »…`;
  let sprite = existing;
  try {
    const payload = { prompt, temperature: Number(temperatureInput.value) };
    if (existing) payload.palette = existing.palette.map(hexToRgb);
    if (!engineReady) status.textContent = 'Le modèle d’IA finit de se charger, la création démarre dès qu’il est prêt…';
    await PixelEngine.generate(payload, data => {
      if (data.type === 'start') {
        if (!sprite) {
          const { pixelSize, x, y: targetY } = spawnPlacement();
          sprite = {
            id: nextId++, name: data.prompt, seed: data.seed,
            tokens: Array(576).fill(0), palette: data.palette.map(rgbToHex),
            transparentIndex: data.transparent_index, pixelSize,
            x, y: targetY - 70, groupId: null,
            bitmapDirty: true
          };
          sprites.push(sprite);
          select(sprite.id);
          animateDrop(sprite, targetY);
        } else {
          sprite.seed = data.seed;
          sprite.tokens = Array(576).fill(0);
          sprite.palette = data.palette.map(rgbToHex);
          sprite.bitmapDirty = true;
          renderUI();
          draw();
        }
      } else if (data.type === 'progress') {
        sprite.tokens = data.tokens;
        sprite.bitmapDirty = true;
        status.textContent = `Génération de « ${sprite.name} » · ${data.step / 24}/24`;
        draw();
      } else if (data.type === 'done') {
        sprite.tokens = data.tokens;
        sprite.seed = data.seed;
        sprite.bitmapDirty = true;
        const translated = data.english_prompt && data.english_prompt !== data.prompt.toLowerCase() ? ` → “${data.english_prompt}”` : '';
        status.textContent = `${existing ? 'Régénéré' : 'Ajouté'} : ${data.prompt}${translated} · graine ${data.seed} · ${(data.ms / 1000).toFixed(1)} s`;
        draw();
      }
    });
    commitHistory(existing ? 'Régénérer un objet' : 'Générer un objet', before);
    if (!existing) {
      promptInput.value = '';
      rotatePlaceholder();
    }
  } catch (error) {
    restoreState(before);
    status.textContent = error.message;
  } finally {
    isGenerating = false;
    generateButton.disabled = false;
    renderUI();
    promptInput.focus();
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (prompt) await generateSprite(prompt);
});

// --- Layer operations

function scaleSelected(amount) {
  const selection = selectedSprites();
  if (!selection.length) return;
  const before = captureState();
  selection.forEach(item => keepCenter(item, () => {
    if (isText(item)) item.fontSize = Math.max(8, Math.min(600, Math.round(item.fontSize * (amount > 0 ? 1.15 : 1 / 1.15))));
    else item.pixelSize = Math.max(2, Math.min(24, item.pixelSize + amount));
  }));
  commitHistory(amount > 0 ? 'Agrandir' : 'Réduire', before);
  renderUI();
  draw();
}

function moveLayer(toFront) {
  const selected = sprites.filter(sprite => selectedIds.has(sprite.id));
  if (!selected.length) return;
  const before = captureState();
  const remaining = sprites.filter(sprite => !selectedIds.has(sprite.id));
  sprites.splice(0, sprites.length, ...(toFront ? [...remaining, ...selected] : [...selected, ...remaining]));
  commitHistory(toFront ? 'Mettre au premier plan' : 'Mettre à l’arrière-plan', before);
  renderUI();
  draw();
}

function deleteSelected() {
  if (!selectedIds.size) return;
  const before = captureState();
  for (let index = sprites.length - 1; index >= 0; index--) {
    if (selectedIds.has(sprites[index].id)) sprites.splice(index, 1);
  }
  selectedIds.clear();
  primaryId = null;
  commitHistory('Supprimer', before);
  renderUI();
  draw();
}

function transformSelected(transform) {
  const selection = selectedSprites().filter(item => !isText(item));
  if (!selection.length) return;
  const before = captureState();
  selection.forEach(sprite => {
    const source = sprite.tokens;
    const transformed = Array(576);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        if (transform === 'horizontal') transformed[y * 24 + (23 - x)] = source[y * 24 + x];
        if (transform === 'vertical') transformed[(23 - y) * 24 + x] = source[y * 24 + x];
        if (transform === 'rotate') transformed[x * 24 + (23 - y)] = source[y * 24 + x];
      }
    }
    sprite.tokens = transformed;
    sprite.bitmapDirty = true;
  });
  const labels = { horizontal: 'Miroir horizontal', vertical: 'Miroir vertical', rotate: 'Pivoter' };
  commitHistory(labels[transform], before);
  renderUI();
  draw();
}

function groupSelected() {
  const selection = selectedSprites();
  if (selection.length < 2) return;
  const before = captureState();
  const groupId = nextGroupId++;
  selection.forEach(sprite => { sprite.groupId = groupId; });
  commitHistory('Grouper', before);
  renderUI();
  draw();
}

function duplicateSelected() {
  const selection = selectedSprites();
  if (!selection.length || isGenerating) return;
  const before = captureState();
  const groupMap = new Map();
  const copies = selection.map(item => {
    if (item.groupId != null && !groupMap.has(item.groupId)) groupMap.set(item.groupId, nextGroupId++);
    const offset = isText(item) ? 16 : item.pixelSize * 2;
    return {
      ...serializeItem(item), id: nextId++, x: item.x + offset, y: item.y + offset,
      groupId: item.groupId == null ? null : groupMap.get(item.groupId), bitmapDirty: true
    };
  });
  sprites.push(...copies);
  selectedIds.clear();
  copies.forEach(copy => selectedIds.add(copy.id));
  primaryId = copies[selection.findIndex(item => item.id === primaryId)]?.id ?? copies.at(-1).id;
  commitHistory('Dupliquer', before);
  status.textContent = `Dupliqué : ${copies.length > 1 ? `${copies.length} objets` : itemName(copies[0])}`;
  renderUI();
  draw();
}

function ungroupSelected() {
  const selection = selectedSprites().filter(sprite => sprite.groupId != null);
  if (!selection.length) return;
  const before = captureState();
  const groupIds = new Set(selection.map(sprite => sprite.groupId));
  sprites.forEach(sprite => {
    if (groupIds.has(sprite.groupId)) sprite.groupId = null;
  });
  commitHistory('Dégrouper', before);
  renderUI();
  draw();
}

// Both inspectors share the same "Calque" tools.
const layerActions = {
  smaller: () => scaleSelected(-1), larger: () => scaleSelected(1), duplicate: duplicateSelected,
  back: () => moveLayer(false), front: () => moveLayer(true), delete: deleteSelected
};
document.querySelectorAll('.layer-tools').forEach(container => {
  container.append(document.querySelector('#layerToolsTemplate').content.cloneNode(true));
});
document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', () => layerActions[button.dataset.action]());
});
document.querySelectorAll('[data-deselect]').forEach(button => button.addEventListener('click', () => select(null)));
document.querySelector('#flipHorizontalButton').addEventListener('click', () => transformSelected('horizontal'));
document.querySelector('#flipVerticalButton').addEventListener('click', () => transformSelected('vertical'));
document.querySelector('#rotateButton').addEventListener('click', () => transformSelected('rotate'));
groupButton.addEventListener('click', groupSelected);
ungroupButton.addEventListener('click', ungroupSelected);
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
temperatureInput.addEventListener('input', () => {
  temperatureValue.value = Number(temperatureInput.value).toFixed(1);
});
regenerateButton.addEventListener('click', async () => {
  const sprite = selectedSprite();
  if (sprite && !isText(sprite)) await generateSprite(sprite.prompt ?? sprite.name, sprite);
});
randomPaletteButton.addEventListener('click', async () => {
  const selection = selectedSprites().filter(item => !isText(item));
  if (!selection.length) return;
  const before = captureState();
  randomPaletteButton.disabled = true;
  try {
    const data = { palette: await PixelEngine.randomPalette() };
    selection.forEach(sprite => {
      sprite.palette = data.palette.map(rgbToHex);
      sprite.bitmapDirty = true;
    });
    commitHistory('Palette au hasard', before);
    renderUI();
    draw();
    status.textContent = `Nouvelle palette pour ${selection.length === 1 ? selection[0].name : `${selection.length} objets`}`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    randomPaletteButton.disabled = false;
  }
});
document.querySelector('#clearButton').addEventListener('click', () => {
  if (!sprites.length || !confirm('Effacer tout le contenu de la carte ?')) return;
  const before = captureState();
  sprites.length = 0;
  selectedIds.clear();
  primaryId = null;
  commitHistory('Tout effacer', before);
  renderUI();
  draw();
});

// --- Text layers

let fontsVersion = 0;
let textEditBefore = null;

function fitTextWidth(item, maxWidth) {
  const natural = itemBox(item);
  if (natural.w > maxWidth) item.fontSize = Math.max(8, Math.floor(item.fontSize * maxWidth / natural.w));
}

function addText() {
  const before = captureState();
  const item = {
    id: nextId++, type: 'text', text: 'Bonjour !', font: 'Anton', fontSize: Math.round(card.h * 0.12),
    bold: false, italic: false, underline: false, color: '#3045D1', style: 'uni', shape: 'droit', groupId: null, x: 0, y: 0
  };
  // Start at a size that fits comfortably inside the card, whatever its orientation.
  fitTextWidth(item, card.w * 0.8);
  const box = itemBox(item);
  item.x = card.x + (card.w - box.w) / 2;
  item.y = card.y + (card.h - box.h) / 2;
  sprites.push(item);
  selectedIds.clear();
  selectedIds.add(item.id);
  primaryId = item.id;
  commitHistory('Ajouter du texte', before);
  renderUI();
  draw();
  textContent.focus();
  textContent.select();
}

// Apply an edit to the selected text layer. Live edits (typing, sliders) share one history entry until "change".
function editText(change, label = null) {
  const item = selectedSprite();
  if (!isText(item)) return;
  textEditBefore ||= captureState();
  keepCenter(item, () => change(item));
  if (label) {
    commitHistory(label, textEditBefore);
    textEditBefore = null;
  }
  renderUI();
  draw();
  scheduleDraftSave();
}

function finishTextEdit(label) {
  if (!textEditBefore) return;
  commitHistory(label, textEditBefore);
  textEditBefore = null;
}

function renderTextInspector(item) {
  if (document.activeElement !== textContent) textContent.value = item.text;
  textFont.value = item.font;
  textColor.value = item.color;
  textSize.value = item.fontSize;
  Object.entries(formatToggles).forEach(([property, selector]) => {
    document.querySelector(selector).setAttribute('aria-pressed', String(Boolean(item[property])));
  });
  textStyles.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.style === item.style));
    const previewKey = `${item.font}|${item.color}|${fontsVersion}`;
    if (button.dataset.previewKey === previewKey) return;
    button.dataset.previewKey = previewKey;
    const preview = WordArt.render({ ...item, text: 'Abc', fontSize: 30, shape: 'droit', underline: false, style: button.dataset.style }, 2);
    button.querySelector('canvas').replaceWith(preview.canvas);
  });
  textShapes.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.shape === item.shape));
  });
}

function buildTextInspector() {
  WordArt.FONTS.forEach(font => {
    const option = document.createElement('option');
    option.value = font.id;
    option.textContent = font.label;
    option.style.fontFamily = font.stack;
    textFont.append(option);
  });
  WordArt.STYLES.forEach(style => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-option';
    button.dataset.style = style.id;
    button.append(document.createElement('canvas'), style.label);
    button.addEventListener('click', () => editText(item => { item.style = style.id; }, `WordArt ${style.label}`));
    textStyles.append(button);
  });
  WordArt.SHAPES.forEach(shape => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ia-tag';
    button.dataset.shape = shape.id;
    button.textContent = shape.label;
    button.addEventListener('click', () => editText(item => { item.shape = shape.id; }, `Forme ${shape.label.toLowerCase()}`));
    textShapes.append(button);
  });
  textContent.addEventListener('input', () => editText(item => { item.text = textContent.value; }));
  textContent.addEventListener('change', () => finishTextEdit('Modifier le texte'));
  textFont.addEventListener('change', () => editText(item => { item.font = textFont.value; }, 'Changer la police'));
  textColor.addEventListener('input', () => editText(item => { item.color = textColor.value; }));
  textColor.addEventListener('change', () => finishTextEdit('Couleur du texte'));
  textSize.addEventListener('input', () => editText(item => { item.fontSize = Number(textSize.value); }));
  textSize.addEventListener('change', () => finishTextEdit('Taille du texte'));
  const labels = { bold: 'Gras', italic: 'Italique', underline: 'Souligné' };
  Object.entries(formatToggles).forEach(([property, selector]) => {
    document.querySelector(selector).addEventListener('click', () => {
      editText(item => { item[property] = !item[property]; }, labels[property]);
    });
  });
}

// Canvas text only uses a web font once it is loaded: load them all, then re-render every text layer.
async function loadFonts() {
  await Promise.allSettled(WordArt.FONTS.flatMap(font => [
    document.fonts.load(`400 40px ${font.stack}`), document.fonts.load(`700 40px ${font.stack}`)
  ]));
  fontsVersion++;
  sprites.filter(isText).forEach(item => keepCenter(item, () => {}));
  renderUI();
  draw();
}

// --- Export, print, publish

// Render only the card, at print resolution. Each sprite pixel becomes a whole number of output pixels.
function renderCardImage(widthPx = null) {
  const [widthMm, heightMm] = CARD_MM[cardOrientation];
  const output = document.createElement('canvas');
  output.width = widthPx ?? Math.round(widthMm / 25.4 * PRINT_DPI);
  output.height = Math.round(output.width * heightMm / widthMm);
  const scale = output.width / card.w;
  const outputContext = output.getContext('2d');
  outputContext.fillStyle = cardBackground;
  outputContext.fillRect(0, 0, output.width, output.height);
  sprites.forEach(item => {
    const x = Math.round((Math.round(item.x) - card.x) * scale);
    const y = Math.round((Math.round(item.y) - card.y) * scale);
    if (isText(item)) {
      const rendering = WordArt.render(item, scale);
      outputContext.imageSmoothingEnabled = true;
      outputContext.drawImage(rendering.canvas, Math.round((item.x - card.x) * scale), Math.round((item.y - card.y) * scale));
      return;
    }
    const side = Math.max(1, Math.round(item.pixelSize * scale)) * 24;
    outputContext.imageSmoothingEnabled = false;
    outputContext.drawImage(spriteBitmap(item), x, y, side, side);
  });
  return output;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

// Insert a pHYs chunk so image viewers and print shops read the file as 300 dpi (15 x 10 cm).
function withPrintResolution(pngBytes) {
  const pixelsPerMetre = Math.round(PRINT_DPI / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, pixelsPerMetre);
  view.setUint32(12, pixelsPerMetre);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (let index = 4; index < 17; index++) crc = CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const headerEnd = 8 + 25;
  const result = new Uint8Array(pngBytes.length + chunk.length);
  result.set(pngBytes.subarray(0, headerEnd));
  result.set(chunk, headerEnd);
  result.set(pngBytes.subarray(headerEnd), headerEnd + chunk.length);
  return result;
}

document.querySelector('#exportButton').addEventListener('click', () => {
  renderCardImage().toBlob(async blob => {
    const bytes = withPrintResolution(new Uint8Array(await blob.arrayBuffer()));
    const link = document.createElement('a');
    link.download = `carte-postale-${cardOrientation}-15x10cm-300dpi.png`;
    link.href = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status.textContent = 'Carte exportée en PNG (15 × 10 cm à 300 dpi)';
  }, 'image/png');
});

document.querySelector('#printButton').addEventListener('click', () => {
  const [widthMm, heightMm] = CARD_MM[cardOrientation];
  printImage.src = renderCardImage().toDataURL('image/png');
  printImage.style.width = `${widthMm}mm`;
  printImage.style.height = `${heightMm}mm`;
  let pageStyle = document.querySelector('#printPageStyle');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'printPageStyle';
    document.head.append(pageStyle);
  }
  pageStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  printImage.decode().then(() => window.print());
});

function openPublish() {
  if (!sprites.length) {
    status.textContent = 'La carte est vide : ajoutez au moins une vignette ou un texte avant de publier.';
    return;
  }
  select(null);
  publishPreview.src = renderCardImage(900).toDataURL('image/png');
  publishStatus.textContent = '';
  publishStatus.classList.remove('error');
  publishSubmit.disabled = false;
  publishSubmit.hidden = false;
  publishDialog.hidden = false;
  document.querySelector('#publishTitleInput').focus();
}

function closePublish() {
  publishDialog.hidden = true;
}

publishForm.addEventListener('submit', async event => {
  event.preventDefault();
  publishSubmit.disabled = true;
  publishStatus.classList.remove('error');
  publishStatus.textContent = 'Publication en cours…';
  try {
    const response = await fetch('/api/creations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.querySelector('#publishTitleInput').value,
        author: document.querySelector('#publishAuthorInput').value,
        orientation: cardOrientation,
        image: renderCardImage(1200).toDataURL('image/png')
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'La publication a échoué.');
    publishStatus.innerHTML = 'Merci ! Votre carte est dans la galerie. <a href="/galerie" target="_blank" rel="noopener">Voir la galerie collective ➭</a>';
    publishSubmit.hidden = true;
    status.textContent = `Carte « ${data.title} » publiée dans la galerie collective`;
  } catch (error) {
    publishStatus.classList.add('error');
    publishStatus.textContent = error.message;
    publishSubmit.disabled = false;
  }
});
document.querySelector('#publishButton').addEventListener('click', openPublish);
document.querySelectorAll('[data-close-publish]').forEach(button => button.addEventListener('click', closePublish));
publishDialog.addEventListener('click', event => {
  if (event.target === publishDialog) closePublish();
});

// --- Starting points: example prompts, compositions and the sprite library.

function rotatePlaceholder() {
  promptInput.placeholder = `ex. ${EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]}`;
}

function renderExamples() {
  [...EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 10).forEach(example => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ia-tag';
    button.textContent = example;
    button.addEventListener('click', () => generateSprite(example));
    examplesElement.append(button);
  });
}

function tokensFromString(value) {
  return Array.from(value, Number);
}

function addSprite({ name, prompt, tokens, palette, seed = null }) {
  if (isGenerating) return;
  const before = captureState();
  const { pixelSize, x, y } = spawnPlacement();
  const sprite = {
    id: nextId++, name, prompt, seed, tokens, palette, transparentIndex: 0, pixelSize, x, y, groupId: null, bitmapDirty: true
  };
  sprites.push(sprite);
  selectedIds.clear();
  selectedIds.add(sprite.id);
  primaryId = sprite.id;
  commitHistory('Ajouter depuis la bibliothèque', before);
  status.textContent = `Ajouté depuis la bibliothèque : ${name}`;
  renderUI();
  draw();
}

function loadComposition(composition) {
  if (isGenerating) return;
  if (sprites.length && !confirm('Remplacer la carte actuelle par cette composition ?')) return;
  const before = captureState();
  cardOrientation = composition.orientation;
  cardBackground = composition.background;
  card = computeCard();
  sprites.length = 0;
  composition.sprites.forEach(item => {
    const pixelSize = Math.max(2, Math.round(item.size * card.h / 24));
    const half = pixelSize * 12;
    sprites.push({
      id: nextId++, name: item.name, prompt: item.prompt, seed: item.seed, tokens: tokensFromString(item.tokens),
      palette: [...composition.palette], transparentIndex: 0, pixelSize,
      x: card.x + item.cx * card.w - half, y: card.y + item.cy * card.h - half, groupId: null, bitmapDirty: true
    });
  });
  // Postcard texts go on top, shrunk if a font is wider than expected so they stay inside the card.
  (composition.texts ?? []).forEach(entry => {
    const text = {
      id: nextId++, type: 'text', text: entry.text, font: entry.font, fontSize: Math.round(entry.size * card.h),
      bold: Boolean(entry.bold), italic: false, underline: false, color: entry.color, style: entry.style,
      shape: entry.shape, groupId: null, x: 0, y: 0
    };
    fitTextWidth(text, card.w * 0.92);
    const box = itemBox(text);
    text.x = card.x + entry.cx * card.w - box.w / 2;
    text.y = card.y + entry.cy * card.h - box.h / 2;
    sprites.push(text);
  });
  selectedIds.clear();
  primaryId = null;
  commitHistory(`Composition « ${composition.title} »`, before);
  status.textContent = `Composition « ${composition.title} » chargée : déplacez, agrandissez, régénérez ou ajoutez vos propres vignettes.`;
  closeLibrary();
  renderUI();
  draw();
}

function paintTokens(target, tokens, palette, background = null) {
  const targetContext = target.getContext('2d');
  if (background) {
    targetContext.fillStyle = background;
    targetContext.fillRect(0, 0, target.width, target.height);
  }
  return (offsetX, offsetY, pixel) => {
    for (let index = 0; index < 576; index++) {
      const role = tokens[index];
      if (!role) continue;
      targetContext.fillStyle = palette[role];
      targetContext.fillRect(offsetX + (index % 24) * pixel, offsetY + Math.floor(index / 24) * pixel, pixel, pixel);
    }
  };
}

function compositionPreview(composition) {
  const preview = document.createElement('canvas');
  const [widthMm, heightMm] = CARD_MM[composition.orientation];
  preview.height = 320;
  preview.width = Math.round(320 * widthMm / heightMm);
  const previewContext = preview.getContext('2d');
  previewContext.fillStyle = composition.background;
  previewContext.fillRect(0, 0, preview.width, preview.height);
  composition.sprites.forEach(item => {
    const pixel = Math.max(1, Math.round(item.size * preview.height / 24));
    const half = pixel * 12;
    paintTokens(preview, tokensFromString(item.tokens), composition.palette)(
      Math.round(item.cx * preview.width - half), Math.round(item.cy * preview.height - half), pixel
    );
  });
  (composition.texts ?? []).forEach(entry => {
    const options = { ...entry, italic: false, underline: false };
    let rendering = WordArt.render({ ...options, fontSize: entry.size * preview.height });
    if (rendering.width > preview.width * 0.92) {
      rendering = WordArt.render({ ...options, fontSize: entry.size * preview.height * preview.width * 0.92 / rendering.width });
    }
    previewContext.drawImage(rendering.canvas, entry.cx * preview.width - rendering.width / 2, entry.cy * preview.height - rendering.height / 2);
  });
  return preview;
}

// Previews are drawn only when they scroll into view: a hundred cards with WordArt would stall the dialog.
const previewObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    previewObserver.unobserve(entry.target);
    entry.target.querySelector('canvas').replaceWith(compositionPreview(entry.target.composition));
  });
}, { root: libraryGrid, rootMargin: '200px' });

function compositionTile(composition) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'library-item composition-item';
  item.composition = composition;
  const placeholder = document.createElement('canvas');
  const [widthMm, heightMm] = CARD_MM[composition.orientation];
  placeholder.width = widthMm;
  placeholder.height = heightMm;
  placeholder.style.background = composition.background;
  const label = document.createElement('span');
  label.textContent = composition.title;
  const meta = document.createElement('small');
  meta.textContent = `${composition.category ?? 'Exemple'} · ${composition.orientation === 'landscape' ? 'paysage' : 'portrait'}`;
  item.append(placeholder, label, meta);
  item.addEventListener('click', () => loadComposition(composition));
  previewObserver.observe(item);
  return item;
}

let compositionCategory = null;

function renderCompositions() {
  const categories = [...new Set(compositions.map(composition => composition.category).filter(Boolean))];
  const filters = document.createElement('div');
  filters.className = 'composition-filters';
  [null, ...categories].forEach(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ia-tag';
    button.textContent = category ?? `Toutes (${compositions.length})`;
    button.setAttribute('aria-pressed', String(category === compositionCategory));
    button.addEventListener('click', () => {
      compositionCategory = category;
      showLibraryTab('compositions');
    });
    filters.append(button);
  });
  const shown = compositions.filter(composition => !compositionCategory || composition.category === compositionCategory);
  libraryGrid.replaceChildren(filters, ...shown.map(compositionTile));
}

async function loadLibraryData() {
  if (!compositions) compositions = await (await fetch('/static/data/compositions.json')).json();
  if (!libraryData) libraryData = await (await fetch('/static/data/library.json')).json();
}

function showLibraryTab(tab) {
  lastLibraryTab = tab;
  libraryTabs.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.tab === String(tab)));
  });
  libraryGrid.replaceChildren();
  libraryGrid.scrollTop = 0;
  libraryGrid.classList.toggle('compositions', tab === 'compositions');
  libraryGrid.classList.remove('search-results');
  if (tab === 'compositions') {
    libraryHint.textContent = 'Des cartes postales déjà composées avec le modèle, pour trouver des idées. Chargez-en une puis modifiez-la : vignettes et textes restent déplaçables, modifiables et régénérables.';
    renderCompositions();
    return;
  }
  libraryHint.textContent = 'Exemples du jeu de données qui a servi à entraîner le modèle. Cliquez sur une vignette pour la poser sur la carte ; « Régénérer » en fera une variante avec le modèle.';
  libraryData.sprites.filter(entry => entry[0] === Number(tab)).forEach(entry => libraryGrid.append(libraryTile(entry)));
}

function libraryTile([, caption, english, paletteHex, tokenString]) {
  const palette = paletteHex.match(/.{6}/g).map(hex => `#${hex}`);
  const tokens = tokensFromString(tokenString);
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'library-item';
  item.title = `${caption} (${english})`;
  const tile = document.createElement('canvas');
  tile.width = 24;
  tile.height = 24;
  paintTokens(tile, tokens, palette, palette[0])(0, 0, 1);
  const label = document.createElement('span');
  label.textContent = caption;
  item.append(tile, label);
  item.addEventListener('click', () => {
    closeLibrary();
    addSprite({ name: caption, prompt: english, tokens, palette });
  });
  return item;
}

function resultSection(title, count, items, kind) {
  const section = document.createElement('section');
  section.className = `search-section ${kind}`;
  const heading = document.createElement('h3');
  heading.className = 'search-heading';
  heading.innerHTML = `${escapeHTML(title)} <small>${escapeHTML(String(count))}</small>`;
  const grid = document.createElement('div');
  grid.className = 'search-grid';
  grid.append(...items);
  section.append(heading, grid);
  return section;
}

// Lowercase, without accents, so "Épée" matches "epee".
function normalizeSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Every word must appear in the French name, the original English caption or the family name.
// Plural endings are dropped so "étoiles" also finds "étoile"; whole-word matches ("lune") rank before
// partial ones ("lunettes").
function searchLibrary(query) {
  const singular = word => word.length > 3 ? word.replace(/(s|x)$/, '') : word;
  const words = normalizeSearch(query).split(/[^a-z0-9]+/).filter(Boolean).map(singular);
  libraryTabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
  libraryGrid.classList.remove('compositions', 'search-results');
  libraryGrid.scrollTop = 0;
  const matches = [];
  libraryData.sprites.forEach(entry => {
    const haystack = normalizeSearch(`${entry[1]} ${entry[2]} ${libraryData.families[entry[0]]}`);
    if (!words.every(word => haystack.includes(word))) return;
    const haystackWords = new Set(haystack.split(/[^a-z0-9]+/).map(singular));
    matches.push({ entry, score: words.filter(word => haystackWords.has(word)).length });
  });
  matches.sort((a, b) => b.score - a.score);
  const shown = matches.slice(0, 240);
  const cards = compositions.filter(composition => {
    const haystack = normalizeSearch(`${composition.title} ${composition.category ?? ''} ${composition.sprites.map(item => item.name).join(' ')} ${(composition.texts ?? []).map(item => item.text).join(' ')}`);
    return words.every(word => haystack.includes(word));
  });
  const label = query.trim();
  if (matches.length || cards.length) {
    // With an empty card, example cards come first (ideas to start from). Once a card is in progress,
    // the person is most likely looking for a vignette to add, so vignettes come first.
    const working = sprites.length > 0;
    const vignetteSection = matches.length && resultSection(
      'Vignettes', `${matches.length}${matches.length > shown.length ? ` (${shown.length} premières)` : ''}`,
      shown.map(match => libraryTile(match.entry)), 'vignettes');
    const cardSection = cards.length && resultSection('Cartes d’exemple', cards.length, cards.map(compositionTile), 'cards');
    const sections = (working ? [vignetteSection, cardSection] : [cardSection, vignetteSection]).filter(Boolean);
    libraryGrid.classList.add('search-results');
    libraryGrid.replaceChildren(...sections);
    const parts = [];
    if (matches.length) parts.push(`${matches.length} vignette${matches.length > 1 ? 's' : ''} à poser sur la carte`);
    if (cards.length) parts.push(`${cards.length} carte${cards.length > 1 ? 's' : ''} d’exemple${working ? ' (elles remplacent la carte en cours)' : ''}`);
    libraryHint.textContent = `Pour « ${label} » : ${(working ? parts : parts.reverse()).join(' et ')}.`;
    return;
  }
  libraryHint.textContent = `Aucune vignette pour « ${label} » dans la bibliothèque. Le modèle peut l'inventer :`;
  const generate = document.createElement('button');
  generate.type = 'button';
  generate.className = 'ia-btn ia-btn--primary library-generate';
  generate.textContent = `Générer « ${label} » avec le modèle`;
  generate.addEventListener('click', () => {
    closeLibrary();
    generateSprite(label);
  });
  libraryGrid.replaceChildren(generate);
}

async function openLibrary(tab = 'compositions') {
  library.hidden = false;
  libraryHint.textContent = 'Chargement…';
  try {
    await loadLibraryData();
  } catch {
    libraryHint.textContent = 'Impossible de charger la bibliothèque.';
    return;
  }
  if (!libraryTabs.children.length) {
    const tabs = [['compositions', 'Compositions'], ...libraryData.families.map((label, index) => [String(index), label])];
    tabs.forEach(([key, label], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ia-tag${index === 0 ? ' first' : ''}`;
      button.dataset.tab = key;
      button.textContent = label;
      button.addEventListener('click', () => {
        librarySearch.value = '';
        showLibraryTab(key);
      });
      libraryTabs.append(button);
    });
  }
  librarySearch.value = '';
  showLibraryTab(tab);
  if (tab !== 'compositions') librarySearch.focus();
}

let lastLibraryTab = 'compositions';
librarySearch.addEventListener('input', () => {
  if (!libraryData) return;
  if (librarySearch.value.trim()) searchLibrary(librarySearch.value);
  else showLibraryTab(lastLibraryTab);
});

function closeLibrary() {
  library.hidden = true;
}

document.querySelector('#libraryButton').addEventListener('click', () => openLibrary());
document.querySelector('#closeLibrary').addEventListener('click', closeLibrary);
library.addEventListener('click', event => {
  if (event.target === library) closeLibrary();
});
document.querySelectorAll('[data-library-tab]').forEach(button => {
  button.addEventListener('click', () => openLibrary(button.dataset.libraryTab));
});
document.querySelector('#addTextButton').addEventListener('click', addText);
document.querySelectorAll('[data-add-text]').forEach(button => button.addEventListener('click', addText));
landscapeButton.addEventListener('click', () => setOrientation('landscape'));
portraitButton.addEventListener('click', () => setOrientation('portrait'));
let backgroundBefore = null;
cardBackgroundInput.addEventListener('input', () => {
  backgroundBefore ||= captureState();
  cardBackground = cardBackgroundInput.value;
  renderUI();
  draw();
});
cardBackgroundInput.addEventListener('change', () => {
  commitHistory('Changer le fond', backgroundBefore || captureState());
  backgroundBefore = null;
});

// --- Keyboard

function isTypingField(element) {
  return element?.tagName === 'TEXTAREA' || (element?.tagName === 'INPUT' && ['text', 'search'].includes(element.type));
}

document.addEventListener('keydown', event => {
  if (!library.hidden || !publishDialog.hidden || !aboutDialog.hidden) {
    if (event.key === 'Escape') {
      closeLibrary();
      closePublish();
      aboutDialog.hidden = true;
    }
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const active = document.activeElement;
  // While typing, keys belong to the field, except shortcuts in an empty prompt.
  const typing = isTypingField(active) && !(active === promptInput && !promptInput.value);
  if (typing) {
    if (event.key === 'Escape') active.blur();
    return;
  }
  if (command && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && key === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (command && key === 'g') {
    event.preventDefault();
    if (event.shiftKey) ungroupSelected();
    else groupSelected();
    return;
  }
  if (command && key === 'd') {
    event.preventDefault();
    duplicateSelected();
    return;
  }
  if (active === promptInput) return;
  if (command && key === 'a') {
    event.preventDefault();
    selectedIds.clear();
    sprites.forEach(sprite => selectedIds.add(sprite.id));
    primaryId = sprites.at(-1)?.id ?? null;
    renderUI();
    draw();
  }
  if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
  if (event.key === '[') moveLayer(false);
  if (event.key === ']') moveLayer(true);
  if (event.key === 'Escape') select(null);
});

// --- In-browser model

let engineReady = false;
const engineBar = document.querySelector('#engineBar');
const engineLabel = document.querySelector('#engineLabel');

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1e6)} Mo`;
}

// ?moteur=processeur or ?moteur=carte-graphique forces a backend (useful to compare speeds on a machine).
const requestedBackend = { processeur: 'wasm', 'carte-graphique': 'webgpu' }[new URLSearchParams(location.search).get('moteur')] ?? null;
PixelEngine.load((loaded, total) => {
  const ratio = total ? Math.min(1, loaded / total) : 0;
  engineBar.style.setProperty('--progress', ratio);
  engineLabel.textContent = ratio < 1
    ? `Préparation du modèle d'IA : ${formatMegabytes(loaded)} / ${formatMegabytes(total)} (téléchargé une seule fois sur cet ordinateur)`
    : 'Démarrage du modèle d’IA…';
}, requestedBackend).then(backend => {
  engineReady = true;
  document.body.classList.add('engine-ready');
  engineLabel.textContent = `Modèle d'IA prêt sur cet ordinateur (${backend === 'webgpu' ? 'carte graphique' : 'processeur'}).`;
  setTimeout(() => document.querySelector('#engineStatus').classList.add('done'), 4000);
}).catch(error => {
  document.querySelector('#engineStatus').classList.add('failed');
  engineLabel.textContent = `Le modèle d'IA n'a pas pu démarrer : ${error.message}. Essayez un navigateur récent (Chrome, Edge, Firefox ou Safari).`;
});

// --- About & credits

const aboutDialog = document.querySelector('#aboutDialog');
document.querySelector('#aboutButton').addEventListener('click', () => { aboutDialog.hidden = false; });
document.querySelectorAll('[data-close-about]').forEach(button => button.addEventListener('click', () => { aboutDialog.hidden = true; }));
aboutDialog.addEventListener('click', event => {
  if (event.target === aboutDialog) aboutDialog.hidden = true;
});

window.addEventListener('resize', resizeCanvas);
buildTextInspector();
renderExamples();
rotatePlaceholder();
restoreDraft();
resizeCanvas();
loadFonts();
