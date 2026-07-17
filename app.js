(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const toInt = (value, fallback = 0) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const defaultProject = () => ({
    schemaVersion: 1,
    image: { fileName: '' },
    playback: { loop: true, defaultDurationMs: 100 },
    transparency: {
      mode: 'preserve',
      color: '#ffffff',
      tolerance: 16,
      matteColor: '#ffffff'
    },
    output: {
      width: 256,
      height: 256,
      anchor: { x: 128, y: 220 },
      cropOffset: { x: 0, y: 0 },
      fileNamePattern: 'frame_{index:03}.png'
    },
    frames: []
  });

  const state = {
    project: defaultProject(),
    image: null,
    imageInfo: null,
    selectedIndex: -1,
    currentPreviewIndex: -1,
    playing: false,
    playElapsed: 0,
    playLastTimestamp: 0,
    undo: [],
    redo: [],
    view: { zoom: 1, panX: 0, panY: 0 },
    drag: null,
    dragSnapshot: null,
    timelineDragIndex: null,
    showGuides: true,
    onionSkin: false,
    previewScale: 2,
    includeJsonInZip: true,
    toastTimer: null
  };

  const dom = {
    imageInput: $('imageInput'),
    jsonFileInput: $('jsonFileInput'),
    saveJsonButton: $('saveJsonButton'),
    exportZipButton: $('exportZipButton'),
    imageStatus: $('imageStatus'),
    validationStatus: $('validationStatus'),
    runtimeStatus: $('runtimeStatus'),
    sheetCanvas: $('sheetCanvas'),
    sheetCanvasWrap: $('sheetCanvasWrap'),
    sheetEmpty: $('sheetEmpty'),
    fitSheetButton: $('fitSheetButton'),
    actualSizeButton: $('actualSizeButton'),
    zoomLabel: $('zoomLabel'),
    previewCanvas: $('previewCanvas'),
    previewCanvasWrap: $('previewCanvasWrap'),
    previewFrameLabel: $('previewFrameLabel'),
    previewScaleSelect: $('previewScaleSelect'),
    showGuidesInput: $('showGuidesInput'),
    onionSkinInput: $('onionSkinInput'),
    previousFrameButton: $('previousFrameButton'),
    playButton: $('playButton'),
    nextFrameButton: $('nextFrameButton'),
    selectedFrameId: $('selectedFrameId'),
    frameFieldset: $('frameFieldset'),
    positionFieldset: $('positionFieldset'),
    timingFieldset: $('timingFieldset'),
    sourceX: $('sourceX'), sourceY: $('sourceY'), sourceWidth: $('sourceWidth'), sourceHeight: $('sourceHeight'),
    pivotX: $('pivotX'), pivotY: $('pivotY'), offsetX: $('offsetX'), offsetY: $('offsetY'),
    durationMs: $('durationMs'), frameEnabled: $('frameEnabled'),
    centerPivotButton: $('centerPivotButton'), bottomPivotButton: $('bottomPivotButton'), trimSelectedFrameButton: $('trimSelectedFrameButton'),
    addFrameButton: $('addFrameButton'), duplicateFrameButton: $('duplicateFrameButton'), deleteFrameButton: $('deleteFrameButton'),
    outputWidth: $('outputWidth'), outputHeight: $('outputHeight'), anchorX: $('anchorX'), anchorY: $('anchorY'), cropOffsetX: $('cropOffsetX'), cropOffsetY: $('cropOffsetY'),
    centerAnchorButton: $('centerAnchorButton'), bottomAnchorButton: $('bottomAnchorButton'), autoFitMargin: $('autoFitMargin'), autoFitOutputButton: $('autoFitOutputButton'),
    transparencyMode: $('transparencyMode'), keyColor: $('keyColor'), colorTolerance: $('colorTolerance'), matteColor: $('matteColor'), trimAllFramesButton: $('trimAllFramesButton'),
    fileNamePattern: $('fileNamePattern'), includeJsonInZip: $('includeJsonInZip'), defaultDurationMs: $('defaultDurationMs'), loopPlayback: $('loopPlayback'),
    jsonEditor: $('jsonEditor'), applyJsonButton: $('applyJsonButton'), formatJsonButton: $('formatJsonButton'), copyJsonButton: $('copyJsonButton'), jsonErrors: $('jsonErrors'),
    timelineFrames: $('timelineFrames'), undoButton: $('undoButton'), redoButton: $('redoButton'),
    toast: $('toast')
  };

  const sheetCtx = dom.sheetCanvas.getContext('2d');
  const previewCtx = dom.previewCanvas.getContext('2d');
  const workingCanvas = document.createElement('canvas');
  const workingCtx = workingCanvas.getContext('2d', { willReadFrequently: true });

  function setRuntimeStatus(message) {
    dom.runtimeStatus.textContent = message;
  }

  function toast(message, isError = false) {
    clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle('error', isError);
    dom.toast.classList.add('visible');
    state.toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 2600);
  }

  function pushUndo(snapshot = clone(state.project)) {
    state.undo.push(snapshot);
    if (state.undo.length > 80) state.undo.shift();
    state.redo.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    dom.undoButton.disabled = state.undo.length === 0;
    dom.redoButton.disabled = state.redo.length === 0;
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(clone(state.project));
    state.project = state.undo.pop();
    normalizeSelection();
    refreshAll();
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(clone(state.project));
    state.project = state.redo.pop();
    normalizeSelection();
    refreshAll();
  }

  function normalizeSelection() {
    if (!state.project.frames.length) {
      state.selectedIndex = -1;
      state.currentPreviewIndex = -1;
      state.playing = false;
      return;
    }
    state.selectedIndex = clamp(state.selectedIndex < 0 ? 0 : state.selectedIndex, 0, state.project.frames.length - 1);
    state.currentPreviewIndex = clamp(state.currentPreviewIndex < 0 ? state.selectedIndex : state.currentPreviewIndex, 0, state.project.frames.length - 1);
  }

  function selectedFrame() {
    return state.project.frames[state.selectedIndex] || null;
  }

  function enabledFrameIndexes() {
    return state.project.frames.map((frame, index) => frame.enabled ? index : -1).filter((index) => index >= 0);
  }

  function nextFrameIndex(from, direction) {
    const indexes = enabledFrameIndexes();
    if (!indexes.length) return -1;
    const currentPosition = indexes.indexOf(from);
    if (currentPosition < 0) return direction > 0 ? indexes[0] : indexes[indexes.length - 1];
    const nextPosition = currentPosition + direction;
    if (nextPosition >= indexes.length) return state.project.playback.loop ? indexes[0] : indexes[indexes.length - 1];
    if (nextPosition < 0) return state.project.playback.loop ? indexes[indexes.length - 1] : indexes[0];
    return indexes[nextPosition];
  }

  function frameDuration(frame) {
    return Math.max(1, toInt(frame?.durationMs, state.project.playback.defaultDurationMs));
  }

  function syncJsonText() {
    dom.jsonEditor.value = JSON.stringify(state.project, null, 2);
  }

  function validateProject(project, includeImageBounds = true) {
    const errors = [];
    if (!project || typeof project !== 'object' || Array.isArray(project)) return ['ルートはオブジェクトである必要があります。'];
    if (project.schemaVersion !== 1) errors.push('schemaVersion は 1 である必要があります。');
    if (!project.playback || typeof project.playback !== 'object') errors.push('playback が必要です。');
    if (typeof project.playback?.loop !== 'boolean') errors.push('playback.loop は boolean である必要があります。');
    if (!Number.isInteger(project.playback?.defaultDurationMs) || project.playback.defaultDurationMs < 1) errors.push('playback.defaultDurationMs は1以上の整数です。');
    const modes = ['preserve', 'opaque', 'colorKey', 'edgeFlood'];
    if (!project.transparency || !modes.includes(project.transparency.mode)) errors.push(`transparency.mode は ${modes.join(' / ')} のいずれかです。`);
    if (!isHexColor(project.transparency?.color)) errors.push('transparency.color は #RRGGBB 形式です。');
    if (!Number.isInteger(project.transparency?.tolerance) || project.transparency.tolerance < 0 || project.transparency.tolerance > 255) errors.push('transparency.tolerance は0〜255の整数です。');
    if (!isHexColor(project.transparency?.matteColor)) errors.push('transparency.matteColor は #RRGGBB 形式です。');
    if (!project.output || typeof project.output !== 'object') errors.push('output が必要です。');
    if (!Number.isInteger(project.output?.width) || project.output.width < 1 || project.output.width > 4096) errors.push('output.width は1〜4096の整数です。');
    if (!Number.isInteger(project.output?.height) || project.output.height < 1 || project.output.height > 4096) errors.push('output.height は1〜4096の整数です。');
    if (!isPoint(project.output?.anchor)) errors.push('output.anchor は整数の x / y を持つ必要があります。');
    if (!isPoint(project.output?.cropOffset)) errors.push('output.cropOffset は整数の x / y を持つ必要があります。');
    if (typeof project.output?.fileNamePattern !== 'string' || !project.output.fileNamePattern.trim()) errors.push('output.fileNamePattern が必要です。');
    if (!Array.isArray(project.frames)) errors.push('frames は配列である必要があります。');

    const ids = new Set();
    (project.frames || []).forEach((frame, index) => {
      const path = `frames[${index}]`;
      if (!frame || typeof frame !== 'object') { errors.push(`${path} はオブジェクトである必要があります。`); return; }
      if (typeof frame.id !== 'string' || !frame.id.trim()) errors.push(`${path}.id が必要です。`);
      else if (ids.has(frame.id)) errors.push(`${path}.id "${frame.id}" が重複しています。`);
      else ids.add(frame.id);
      if (!isRect(frame.source)) errors.push(`${path}.source は x/y/width/height の整数を持ち、width/height は1以上である必要があります。`);
      if (!isPoint(frame.pivot)) errors.push(`${path}.pivot は整数の x/y が必要です。`);
      if (!isPoint(frame.offset)) errors.push(`${path}.offset は整数の x/y が必要です。`);
      if (!Number.isInteger(frame.durationMs) || frame.durationMs < 1) errors.push(`${path}.durationMs は1以上の整数です。`);
      if (typeof frame.enabled !== 'boolean') errors.push(`${path}.enabled は boolean である必要があります。`);
      if (includeImageBounds && state.imageInfo && isRect(frame.source)) {
        if (frame.source.x + frame.source.width > state.imageInfo.width || frame.source.y + frame.source.height > state.imageInfo.height) {
          errors.push(`${path}.source が画像範囲 ${state.imageInfo.width}×${state.imageInfo.height} を超えています。`);
        }
      }
    });
    return errors;
  }

  function isPoint(value) {
    return value && Number.isInteger(value.x) && Number.isInteger(value.y);
  }

  function isRect(value) {
    return value && Number.isInteger(value.x) && value.x >= 0 && Number.isInteger(value.y) && value.y >= 0 && Number.isInteger(value.width) && value.width >= 1 && Number.isInteger(value.height) && value.height >= 1;
  }

  function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function updateValidationStatus() {
    const errors = validateProject(state.project);
    dom.validationStatus.className = errors.length ? 'status-bad' : 'status-good';
    dom.validationStatus.textContent = errors.length ? `JSON: ${errors.length}件の問題` : 'JSON: Valid';
    dom.jsonErrors.hidden = errors.length === 0;
    dom.jsonErrors.textContent = errors.join('\n');
    return errors;
  }

  function normalizeProject(input) {
    const base = defaultProject();
    const project = clone(input);
    project.image = { ...base.image, ...(project.image || {}) };
    project.playback = { ...base.playback, ...(project.playback || {}) };
    project.transparency = { ...base.transparency, ...(project.transparency || {}) };
    project.output = {
      ...base.output,
      ...(project.output || {}),
      anchor: { ...base.output.anchor, ...(project.output?.anchor || {}) },
      cropOffset: { ...base.output.cropOffset, ...(project.output?.cropOffset || {}) }
    };
    project.frames = Array.isArray(project.frames) ? project.frames : [];
    return project;
  }

  function refreshAll() {
    normalizeSelection();
    syncJsonText();
    updateInspector();
    updateOutputInputs();
    updateValidationStatus();
    renderSheet();
    renderPreview();
    renderTimeline();
    updatePlayButton();
  }

  function updateInspector() {
    const frame = selectedFrame();
    const disabled = !frame;
    [dom.frameFieldset, dom.positionFieldset, dom.timingFieldset].forEach((fieldset) => { fieldset.disabled = disabled; });
    dom.duplicateFrameButton.disabled = disabled;
    dom.deleteFrameButton.disabled = disabled;
    dom.selectedFrameId.textContent = frame?.id || 'なし';
    if (!frame) return;
    dom.sourceX.value = frame.source.x;
    dom.sourceY.value = frame.source.y;
    dom.sourceWidth.value = frame.source.width;
    dom.sourceHeight.value = frame.source.height;
    dom.pivotX.value = frame.pivot.x;
    dom.pivotY.value = frame.pivot.y;
    dom.offsetX.value = frame.offset.x;
    dom.offsetY.value = frame.offset.y;
    dom.durationMs.value = frame.durationMs;
    dom.frameEnabled.checked = frame.enabled;
  }

  function updateOutputInputs() {
    const p = state.project;
    dom.outputWidth.value = p.output.width;
    dom.outputHeight.value = p.output.height;
    dom.anchorX.value = p.output.anchor.x;
    dom.anchorY.value = p.output.anchor.y;
    dom.cropOffsetX.value = p.output.cropOffset.x;
    dom.cropOffsetY.value = p.output.cropOffset.y;
    dom.transparencyMode.value = p.transparency.mode;
    dom.keyColor.value = p.transparency.color;
    dom.colorTolerance.value = p.transparency.tolerance;
    dom.matteColor.value = p.transparency.matteColor;
    dom.fileNamePattern.value = p.output.fileNamePattern;
    dom.includeJsonInZip.checked = state.includeJsonInZip;
    dom.defaultDurationMs.value = p.playback.defaultDurationMs;
    dom.loopPlayback.checked = p.playback.loop;
    updatePreviewCanvasSize();
  }

  function updatePlayButton() {
    dom.playButton.textContent = state.playing ? 'Ⅱ' : '▶';
    dom.playButton.title = state.playing ? '一時停止' : '再生';
  }

  function selectFrame(index, syncPreview = true) {
    if (index < 0 || index >= state.project.frames.length) return;
    state.selectedIndex = index;
    if (syncPreview) state.currentPreviewIndex = index;
    updateInspector();
    renderSheet();
    renderPreview();
    renderTimeline();
  }

  function uniqueFrameId() {
    const ids = new Set(state.project.frames.map((frame) => frame.id));
    let number = state.project.frames.length + 1;
    let id;
    do { id = `frame-${String(number++).padStart(3, '0')}`; } while (ids.has(id));
    return id;
  }

  function addFrame() {
    pushUndo();
    const width = state.imageInfo ? Math.min(64, state.imageInfo.width) : 64;
    const height = state.imageInfo ? Math.min(64, state.imageInfo.height) : 64;
    const frame = {
      id: uniqueFrameId(),
      source: { x: 0, y: 0, width, height },
      pivot: { x: Math.round(width / 2), y: height },
      offset: { x: 0, y: 0 },
      durationMs: state.project.playback.defaultDurationMs,
      enabled: true
    };
    state.project.frames.push(frame);
    selectFrame(state.project.frames.length - 1);
    syncAfterMutation();
  }

  function duplicateFrame() {
    const frame = selectedFrame();
    if (!frame) return;
    pushUndo();
    const copy = clone(frame);
    copy.id = uniqueFrameId();
    state.project.frames.splice(state.selectedIndex + 1, 0, copy);
    selectFrame(state.selectedIndex + 1);
    syncAfterMutation();
  }

  function deleteFrame() {
    if (!selectedFrame()) return;
    pushUndo();
    state.project.frames.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.min(state.selectedIndex, state.project.frames.length - 1);
    state.currentPreviewIndex = state.selectedIndex;
    syncAfterMutation();
  }

  function syncAfterMutation({ timeline = true } = {}) {
    syncJsonText();
    updateInspector();
    updateOutputInputs();
    updateValidationStatus();
    renderSheet();
    renderPreview();
    if (timeline) renderTimeline();
  }

  function setupTabs() {
    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
        button.classList.add('active');
        $(`tab-${button.dataset.tab}`).classList.add('active');
      });
    });
  }

  async function loadImageFile(file) {
    if (!file) return;
    setRuntimeStatus('画像を読み込み中…');
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      state.image = image;
      state.imageInfo = { fileName: file.name, width: image.naturalWidth, height: image.naturalHeight, mimeType: file.type };
      state.project.image = { fileName: file.name };
      dom.imageStatus.textContent = `${file.name} — ${image.naturalWidth}×${image.naturalHeight}`;
      dom.sheetEmpty.hidden = true;
      fitSheet();
      syncAfterMutation();
      setRuntimeStatus('Ready');
      toast('スプライトシートを読み込みました。');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setRuntimeStatus('画像の読み込みに失敗');
      toast('画像を読み込めませんでした。', true);
    };
    image.src = url;
  }

  async function loadJsonFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      applyJsonText(text, true);
      toast('JSONを読み込みました。');
    } catch (error) {
      toast(`JSONの読み込みに失敗しました: ${error.message}`, true);
    }
  }

  function applyJsonText(text, addHistory = true) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      dom.jsonErrors.hidden = false;
      dom.jsonErrors.textContent = `JSON構文エラー: ${error.message}`;
      dom.validationStatus.className = 'status-bad';
      dom.validationStatus.textContent = 'JSON: 構文エラー';
      toast('JSONの構文に問題があります。', true);
      return false;
    }
    const candidate = normalizeProject(parsed);
    const errors = validateProject(candidate, false);
    if (errors.length) {
      dom.jsonErrors.hidden = false;
      dom.jsonErrors.textContent = errors.join('\n');
      dom.validationStatus.className = 'status-bad';
      dom.validationStatus.textContent = `JSON: ${errors.length}件の問題`;
      toast('JSONを適用できません。エラーを確認してください。', true);
      return false;
    }
    if (addHistory) pushUndo();
    state.project = candidate;
    state.selectedIndex = candidate.frames.length ? 0 : -1;
    state.currentPreviewIndex = state.selectedIndex;
    state.playing = false;
    refreshAll();
    return true;
  }

  function bindNumberInput(element, getter, setter, options = {}) {
    element.addEventListener('change', () => {
      const before = clone(state.project);
      const value = toInt(element.value, getter());
      const min = options.min ?? -Infinity;
      const max = options.max ?? Infinity;
      const next = clamp(value, min, max);
      if (next === getter()) { element.value = next; return; }
      pushUndo(before);
      setter(next);
      syncAfterMutation({ timeline: options.timeline !== false });
    });
  }

  function bindTextInput(element, getter, setter) {
    element.addEventListener('change', () => {
      const value = element.value;
      if (value === getter()) return;
      pushUndo();
      setter(value);
      syncAfterMutation();
    });
  }

  function bindInputs() {
    bindNumberInput(dom.sourceX, () => selectedFrame()?.source.x ?? 0, (v) => { selectedFrame().source.x = Math.max(0, v); });
    bindNumberInput(dom.sourceY, () => selectedFrame()?.source.y ?? 0, (v) => { selectedFrame().source.y = Math.max(0, v); });
    bindNumberInput(dom.sourceWidth, () => selectedFrame()?.source.width ?? 1, (v) => { selectedFrame().source.width = Math.max(1, v); }, { min: 1 });
    bindNumberInput(dom.sourceHeight, () => selectedFrame()?.source.height ?? 1, (v) => { selectedFrame().source.height = Math.max(1, v); }, { min: 1 });
    bindNumberInput(dom.pivotX, () => selectedFrame()?.pivot.x ?? 0, (v) => { selectedFrame().pivot.x = v; });
    bindNumberInput(dom.pivotY, () => selectedFrame()?.pivot.y ?? 0, (v) => { selectedFrame().pivot.y = v; });
    bindNumberInput(dom.offsetX, () => selectedFrame()?.offset.x ?? 0, (v) => { selectedFrame().offset.x = v; });
    bindNumberInput(dom.offsetY, () => selectedFrame()?.offset.y ?? 0, (v) => { selectedFrame().offset.y = v; });
    bindNumberInput(dom.durationMs, () => selectedFrame()?.durationMs ?? 1, (v) => { selectedFrame().durationMs = Math.max(1, v); }, { min: 1 });

    dom.frameEnabled.addEventListener('change', () => {
      if (!selectedFrame()) return;
      pushUndo();
      selectedFrame().enabled = dom.frameEnabled.checked;
      syncAfterMutation();
    });

    bindNumberInput(dom.outputWidth, () => state.project.output.width, (v) => { state.project.output.width = v; }, { min: 1, max: 4096 });
    bindNumberInput(dom.outputHeight, () => state.project.output.height, (v) => { state.project.output.height = v; }, { min: 1, max: 4096 });
    bindNumberInput(dom.anchorX, () => state.project.output.anchor.x, (v) => { state.project.output.anchor.x = v; });
    bindNumberInput(dom.anchorY, () => state.project.output.anchor.y, (v) => { state.project.output.anchor.y = v; });
    bindNumberInput(dom.cropOffsetX, () => state.project.output.cropOffset.x, (v) => { state.project.output.cropOffset.x = v; });
    bindNumberInput(dom.cropOffsetY, () => state.project.output.cropOffset.y, (v) => { state.project.output.cropOffset.y = v; });
    bindNumberInput(dom.colorTolerance, () => state.project.transparency.tolerance, (v) => { state.project.transparency.tolerance = v; }, { min: 0, max: 255 });
    bindNumberInput(dom.defaultDurationMs, () => state.project.playback.defaultDurationMs, (v) => { state.project.playback.defaultDurationMs = v; }, { min: 1 });
    bindTextInput(dom.fileNamePattern, () => state.project.output.fileNamePattern, (v) => { state.project.output.fileNamePattern = v || 'frame_{index:03}.png'; });

    dom.transparencyMode.addEventListener('change', () => {
      pushUndo(); state.project.transparency.mode = dom.transparencyMode.value; syncAfterMutation();
    });
    dom.keyColor.addEventListener('change', () => {
      pushUndo(); state.project.transparency.color = dom.keyColor.value; syncAfterMutation();
    });
    dom.matteColor.addEventListener('change', () => {
      pushUndo(); state.project.transparency.matteColor = dom.matteColor.value; syncAfterMutation();
    });
    dom.loopPlayback.addEventListener('change', () => {
      pushUndo(); state.project.playback.loop = dom.loopPlayback.checked; syncAfterMutation();
    });
    dom.includeJsonInZip.addEventListener('change', () => { state.includeJsonInZip = dom.includeJsonInZip.checked; });

    dom.centerPivotButton.addEventListener('click', () => {
      const frame = selectedFrame(); if (!frame) return;
      pushUndo(); frame.pivot.x = Math.round(frame.source.width / 2); frame.pivot.y = Math.round(frame.source.height / 2); syncAfterMutation();
    });
    dom.bottomPivotButton.addEventListener('click', () => {
      const frame = selectedFrame(); if (!frame) return;
      pushUndo(); frame.pivot.x = Math.round(frame.source.width / 2); frame.pivot.y = frame.source.height; syncAfterMutation();
    });
    dom.trimSelectedFrameButton.addEventListener('click', trimSelectedFrame);
    dom.centerAnchorButton.addEventListener('click', () => {
      pushUndo(); state.project.output.anchor.x = Math.round(state.project.output.width / 2); state.project.output.anchor.y = Math.round(state.project.output.height / 2); syncAfterMutation();
    });
    dom.bottomAnchorButton.addEventListener('click', () => {
      pushUndo(); state.project.output.anchor.x = Math.round(state.project.output.width / 2); state.project.output.anchor.y = state.project.output.height; syncAfterMutation();
    });
    dom.autoFitOutputButton.addEventListener('click', autoFitOutput);
    dom.trimAllFramesButton.addEventListener('click', trimAllFrames);
  }

  function updatePreviewCanvasSize() {
    const width = state.project.output.width;
    const height = state.project.output.height;
    dom.previewCanvas.width = width;
    dom.previewCanvas.height = height;
    dom.previewCanvas.style.width = `${width * state.previewScale}px`;
    dom.previewCanvas.style.height = `${height * state.previewScale}px`;
  }

  function resizeSheetCanvas() {
    const rect = dom.sheetCanvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (dom.sheetCanvas.width !== width || dom.sheetCanvas.height !== height) {
      dom.sheetCanvas.width = width;
      dom.sheetCanvas.height = height;
      dom.sheetCanvas.style.width = `${rect.width}px`;
      dom.sheetCanvas.style.height = `${rect.height}px`;
    }
    sheetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderSheet();
  }

  function canvasCssSize() {
    const rect = dom.sheetCanvasWrap.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function fitSheet() {
    if (!state.imageInfo) return;
    const size = canvasCssSize();
    const padding = 32;
    state.view.zoom = Math.min((size.width - padding * 2) / state.imageInfo.width, (size.height - padding * 2) / state.imageInfo.height);
    state.view.zoom = clamp(state.view.zoom, 0.03, 16);
    state.view.panX = (size.width - state.imageInfo.width * state.view.zoom) / 2;
    state.view.panY = (size.height - state.imageInfo.height * state.view.zoom) / 2;
    renderSheet();
  }

  function actualSize() {
    if (!state.imageInfo) return;
    const size = canvasCssSize();
    state.view.zoom = 1;
    state.view.panX = (size.width - state.imageInfo.width) / 2;
    state.view.panY = (size.height - state.imageInfo.height) / 2;
    renderSheet();
  }

  function worldToScreen(x, y) {
    return { x: x * state.view.zoom + state.view.panX, y: y * state.view.zoom + state.view.panY };
  }

  function screenToWorld(x, y) {
    return { x: (x - state.view.panX) / state.view.zoom, y: (y - state.view.panY) / state.view.zoom };
  }

  function renderSheet() {
    const size = canvasCssSize();
    sheetCtx.save();
    sheetCtx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    sheetCtx.clearRect(0, 0, size.width, size.height);
    sheetCtx.fillStyle = '#171a1f';
    sheetCtx.fillRect(0, 0, size.width, size.height);
    if (!state.image) {
      sheetCtx.restore();
      dom.zoomLabel.textContent = '—';
      return;
    }

    sheetCtx.save();
    sheetCtx.translate(state.view.panX, state.view.panY);
    sheetCtx.scale(state.view.zoom, state.view.zoom);
    sheetCtx.imageSmoothingEnabled = false;
    sheetCtx.drawImage(state.image, 0, 0);
    sheetCtx.restore();

    const boundsErrors = new Set();
    if (state.imageInfo) {
      state.project.frames.forEach((frame, index) => {
        if (frame.source.x + frame.source.width > state.imageInfo.width || frame.source.y + frame.source.height > state.imageInfo.height) boundsErrors.add(index);
      });
    }

    state.project.frames.forEach((frame, index) => {
      const topLeft = worldToScreen(frame.source.x, frame.source.y);
      const width = frame.source.width * state.view.zoom;
      const height = frame.source.height * state.view.zoom;
      const active = index === state.selectedIndex;
      sheetCtx.save();
      sheetCtx.lineWidth = active ? 2 : 1;
      sheetCtx.strokeStyle = boundsErrors.has(index) ? '#f7768e' : active ? '#7aa2f7' : frame.enabled ? 'rgba(139,213,202,.72)' : 'rgba(169,176,186,.45)';
      sheetCtx.fillStyle = active ? 'rgba(122,162,247,.08)' : 'rgba(0,0,0,.02)';
      sheetCtx.fillRect(topLeft.x, topLeft.y, width, height);
      sheetCtx.strokeRect(Math.round(topLeft.x) + .5, Math.round(topLeft.y) + .5, Math.round(width), Math.round(height));
      sheetCtx.font = '11px system-ui';
      const label = `${index + 1}`;
      const labelWidth = Math.max(22, sheetCtx.measureText(label).width + 10);
      sheetCtx.fillStyle = active ? '#7aa2f7' : '#262b31';
      sheetCtx.fillRect(topLeft.x, topLeft.y - 19, labelWidth, 18);
      sheetCtx.fillStyle = active ? '#111318' : '#e7e9ec';
      sheetCtx.fillText(label, topLeft.x + 5, topLeft.y - 6);
      if (active) drawResizeHandles(topLeft.x, topLeft.y, width, height);
      sheetCtx.restore();
    });

    dom.zoomLabel.textContent = `${Math.round(state.view.zoom * 100)}%`;
    sheetCtx.restore();
  }

  function drawResizeHandles(x, y, width, height) {
    const size = 8;
    const points = handlePoints(x, y, width, height);
    sheetCtx.fillStyle = '#e7e9ec';
    sheetCtx.strokeStyle = '#26303e';
    points.forEach((point) => {
      sheetCtx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
      sheetCtx.strokeRect(point.x - size / 2 + .5, point.y - size / 2 + .5, size - 1, size - 1);
    });
  }

  function handlePoints(x, y, width, height) {
    return [
      { name: 'nw', x, y }, { name: 'n', x: x + width / 2, y }, { name: 'ne', x: x + width, y },
      { name: 'e', x: x + width, y: y + height / 2 }, { name: 'se', x: x + width, y: y + height },
      { name: 's', x: x + width / 2, y: y + height }, { name: 'sw', x, y: y + height }, { name: 'w', x, y: y + height / 2 }
    ];
  }

  function sheetPointer(event) {
    const rect = dom.sheetCanvasWrap.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitHandle(screenPoint) {
    const frame = selectedFrame();
    if (!frame) return null;
    const topLeft = worldToScreen(frame.source.x, frame.source.y);
    const width = frame.source.width * state.view.zoom;
    const height = frame.source.height * state.view.zoom;
    const threshold = 9;
    return handlePoints(topLeft.x, topLeft.y, width, height).find((point) => Math.abs(screenPoint.x - point.x) <= threshold && Math.abs(screenPoint.y - point.y) <= threshold)?.name || null;
  }

  function hitFrame(worldPoint) {
    for (let i = state.project.frames.length - 1; i >= 0; i--) {
      const source = state.project.frames[i].source;
      if (worldPoint.x >= source.x && worldPoint.x <= source.x + source.width && worldPoint.y >= source.y && worldPoint.y <= source.y + source.height) return i;
    }
    return -1;
  }

  function startSheetDrag(event) {
    if (!state.image) return;
    event.preventDefault();
    dom.sheetCanvasWrap.setPointerCapture(event.pointerId);
    const screen = sheetPointer(event);
    const world = screenToWorld(screen.x, screen.y);
    const handle = hitHandle(screen);
    const hitIndex = hitFrame(world);
    state.dragSnapshot = clone(state.project);

    if (handle && selectedFrame()) {
      state.drag = { type: 'resize', handle, startScreen: screen, startWorld: world, startRect: clone(selectedFrame().source), pointerId: event.pointerId };
    } else if (hitIndex >= 0) {
      if (hitIndex !== state.selectedIndex) selectFrame(hitIndex);
      state.drag = { type: 'move', startScreen: screen, startWorld: world, startRect: clone(selectedFrame().source), pointerId: event.pointerId };
    } else {
      state.dragSnapshot = null;
      state.drag = { type: 'pan', startScreen: screen, startPanX: state.view.panX, startPanY: state.view.panY, pointerId: event.pointerId };
      dom.sheetCanvasWrap.classList.add('dragging');
    }
  }

  function moveSheetDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    event.preventDefault();
    const screen = sheetPointer(event);
    if (state.drag.type === 'pan') {
      state.view.panX = state.drag.startPanX + (screen.x - state.drag.startScreen.x);
      state.view.panY = state.drag.startPanY + (screen.y - state.drag.startScreen.y);
      renderSheet();
      return;
    }
    const frame = selectedFrame();
    if (!frame) return;
    const world = screenToWorld(screen.x, screen.y);
    const dx = Math.round(world.x - state.drag.startWorld.x);
    const dy = Math.round(world.y - state.drag.startWorld.y);
    if (state.drag.type === 'move') {
      frame.source.x = Math.max(0, state.drag.startRect.x + dx);
      frame.source.y = Math.max(0, state.drag.startRect.y + dy);
    } else {
      resizeRect(frame.source, state.drag.startRect, state.drag.handle, dx, dy);
    }
    updateInspector();
    syncJsonText();
    updateValidationStatus();
    renderSheet();
    renderPreview();
  }

  function resizeRect(target, start, handle, dx, dy) {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (handle.includes('w')) left = Math.min(right - 1, Math.max(0, start.x + dx));
    if (handle.includes('e')) right = Math.max(left + 1, start.x + start.width + dx);
    if (handle.includes('n')) top = Math.min(bottom - 1, Math.max(0, start.y + dy));
    if (handle.includes('s')) bottom = Math.max(top + 1, start.y + start.height + dy);
    target.x = Math.round(left);
    target.y = Math.round(top);
    target.width = Math.round(right - left);
    target.height = Math.round(bottom - top);
  }

  function endSheetDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    dom.sheetCanvasWrap.releasePointerCapture(event.pointerId);
    dom.sheetCanvasWrap.classList.remove('dragging');
    if (state.drag.type !== 'pan' && state.dragSnapshot && JSON.stringify(state.dragSnapshot) !== JSON.stringify(state.project)) {
      pushUndo(state.dragSnapshot);
      renderTimeline();
    }
    state.drag = null;
    state.dragSnapshot = null;
  }

  function zoomSheet(event) {
    if (!state.image) return;
    event.preventDefault();
    const screen = sheetPointer(event);
    const before = screenToWorld(screen.x, screen.y);
    const factor = Math.exp(-event.deltaY * 0.0015);
    state.view.zoom = clamp(state.view.zoom * factor, 0.03, 24);
    state.view.panX = screen.x - before.x * state.view.zoom;
    state.view.panY = screen.y - before.y * state.view.zoom;
    renderSheet();
  }

  function keyboardSheet(event) {
    if (!selectedFrame() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const step = event.shiftKey ? 10 : 1;
    let handled = true;
    const frame = selectedFrame();
    const before = clone(state.project);
    if (event.key === 'ArrowLeft') frame.source.x = Math.max(0, frame.source.x - step);
    else if (event.key === 'ArrowRight') frame.source.x += step;
    else if (event.key === 'ArrowUp') frame.source.y = Math.max(0, frame.source.y - step);
    else if (event.key === 'ArrowDown') frame.source.y += step;
    else handled = false;
    if (handled) {
      event.preventDefault();
      pushUndo(before);
      syncAfterMutation();
    }
  }

  function hexToRgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function colorDistance(r, g, b, target) {
    return Math.max(Math.abs(r - target.r), Math.abs(g - target.g), Math.abs(b - target.b));
  }

  function buildProcessedFrameCanvas(frame, modeOverride = null) {
    if (!state.image || !frame) return null;
    const width = frame.source.width;
    const height = frame.source.height;
    workingCanvas.width = width;
    workingCanvas.height = height;
    workingCtx.clearRect(0, 0, width, height);
    workingCtx.imageSmoothingEnabled = false;
    workingCtx.drawImage(state.image, frame.source.x, frame.source.y, width, height, 0, 0, width, height);

    const mode = modeOverride || state.project.transparency.mode;
    if (mode === 'preserve') return workingCanvas;
    if (mode === 'opaque') {
      const temp = document.createElement('canvas');
      temp.width = width; temp.height = height;
      const ctx = temp.getContext('2d');
      ctx.fillStyle = state.project.transparency.matteColor;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(workingCanvas, 0, 0);
      workingCanvas.width = width;
      workingCanvas.height = height;
      workingCtx.drawImage(temp, 0, 0);
      return workingCanvas;
    }

    const imageData = workingCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const target = hexToRgb(state.project.transparency.color);
    const tolerance = state.project.transparency.tolerance;
    if (mode === 'colorKey') {
      for (let i = 0; i < data.length; i += 4) {
        if (colorDistance(data[i], data[i + 1], data[i + 2], target) <= tolerance) data[i + 3] = 0;
      }
    } else if (mode === 'edgeFlood') {
      edgeFloodAlpha(data, width, height, target, tolerance);
    }
    workingCtx.putImageData(imageData, 0, 0);
    return workingCanvas;
  }

  function edgeFloodAlpha(data, width, height, target, tolerance) {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    const enqueue = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (visited[index]) return;
      const pixel = index * 4;
      if (colorDistance(data[pixel], data[pixel + 1], data[pixel + 2], target) > tolerance) return;
      visited[index] = 1;
      queue[tail++] = index;
    };
    for (let x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { enqueue(0, y); enqueue(width - 1, y); }
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      data[index * 4 + 3] = 0;
      enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
    }
  }

  function trimFrameTransparent(frame) {
    if (!state.image || !frame) return false;
    const trimMode = state.project.transparency.mode === 'opaque' ? 'preserve' : state.project.transparency.mode;
    const canvas = buildProcessedFrameCanvas(frame, trimMode);
    if (!canvas) return false;
    const width = canvas.width;
    const height = canvas.height;
    const data = workingCtx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return false;
    if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) return false;
    frame.source.x += minX;
    frame.source.y += minY;
    frame.source.width = maxX - minX + 1;
    frame.source.height = maxY - minY + 1;
    frame.pivot.x -= minX;
    frame.pivot.y -= minY;
    return true;
  }

  function trimSelectedFrame() {
    const frame = selectedFrame();
    if (!frame) return;
    if (!state.image) { toast('先にスプライトシートを選択してください。', true); return; }
    const before = clone(state.project);
    if (!trimFrameTransparent(frame)) {
      toast('トリムできる透明余白がありません。');
      return;
    }
    pushUndo(before);
    syncAfterMutation();
    toast('選択フレームの透明余白をトリムしました。');
  }

  function trimAllFrames() {
    if (!state.image) { toast('先にスプライトシートを選択してください。', true); return; }
    const before = clone(state.project);
    let count = 0;
    state.project.frames.forEach((frame) => { if (trimFrameTransparent(frame)) count++; });
    if (!count) {
      toast('トリムできる透明余白がありません。');
      return;
    }
    pushUndo(before);
    syncAfterMutation();
    toast(`${count}フレームの透明余白をトリムしました。`);
  }

  function autoFitOutput() {
    const frames = state.project.frames.filter((frame) => frame.enabled);
    if (!frames.length) { toast('有効なフレームがありません。', true); return; }
    const margin = clamp(toInt(dom.autoFitMargin.value, 8), 0, 512);
    dom.autoFitMargin.value = margin;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    frames.forEach((frame) => {
      const left = frame.offset.x - frame.pivot.x;
      const top = frame.offset.y - frame.pivot.y;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + frame.source.width);
      maxY = Math.max(maxY, top + frame.source.height);
    });
    const width = Math.ceil(maxX - minX + margin * 2);
    const height = Math.ceil(maxY - minY + margin * 2);
    if (width > 4096 || height > 4096) {
      toast(`包含サイズ ${width}×${height} が上限4096pxを超えます。`, true);
      return;
    }
    pushUndo();
    state.project.output.width = Math.max(1, width);
    state.project.output.height = Math.max(1, height);
    state.project.output.anchor.x = Math.round(margin - minX);
    state.project.output.anchor.y = Math.round(margin - minY);
    state.project.output.cropOffset.x = 0;
    state.project.output.cropOffset.y = 0;
    syncAfterMutation();
    toast(`出力キャンバスを ${width}×${height} に合わせました。`);
  }

  function drawFrameToContext(ctx, frame, alpha = 1) {
    const processed = buildProcessedFrameCanvas(frame);
    if (!processed) return;
    const output = state.project.output;
    const drawX = output.anchor.x + frame.offset.x - frame.pivot.x - output.cropOffset.x;
    const drawY = output.anchor.y + frame.offset.y - frame.pivot.y - output.cropOffset.y;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(processed, drawX, drawY);
    ctx.restore();
  }

  function renderPreview() {
    updatePreviewCanvasSize();
    const width = state.project.output.width;
    const height = state.project.output.height;
    previewCtx.clearRect(0, 0, width, height);
    const frame = state.project.frames[state.currentPreviewIndex] || null;
    if (frame && state.image) {
      if (state.onionSkin) {
        const previousIndex = nextFrameIndex(state.currentPreviewIndex, -1);
        if (previousIndex >= 0 && previousIndex !== state.currentPreviewIndex) drawFrameToContext(previewCtx, state.project.frames[previousIndex], .22);
      }
      drawFrameToContext(previewCtx, frame, 1);
    }
    if (state.showGuides) drawPreviewGuides();
    dom.previewFrameLabel.textContent = frame ? `Frame ${state.currentPreviewIndex + 1} / ${state.project.frames.length} — ${frame.id}` : 'Frame 0 / 0';
  }

  function drawPreviewGuides() {
    const output = state.project.output;
    const anchorX = output.anchor.x - output.cropOffset.x;
    const anchorY = output.anchor.y - output.cropOffset.y;
    previewCtx.save();
    previewCtx.lineWidth = 1;
    previewCtx.setLineDash([4, 4]);
    previewCtx.strokeStyle = 'rgba(122,162,247,.75)';
    previewCtx.beginPath();
    previewCtx.moveTo(anchorX + .5, 0); previewCtx.lineTo(anchorX + .5, output.height);
    previewCtx.moveTo(0, anchorY + .5); previewCtx.lineTo(output.width, anchorY + .5);
    previewCtx.stroke();
    previewCtx.setLineDash([]);
    previewCtx.fillStyle = '#7aa2f7';
    previewCtx.fillRect(anchorX - 2, anchorY - 2, 5, 5);
    previewCtx.strokeStyle = 'rgba(231,233,236,.55)';
    previewCtx.strokeRect(.5, .5, output.width - 1, output.height - 1);
    previewCtx.restore();
  }

  function togglePlay() {
    if (!enabledFrameIndexes().length) return;
    state.playing = !state.playing;
    state.playElapsed = 0;
    state.playLastTimestamp = performance.now();
    if (state.currentPreviewIndex < 0 || !state.project.frames[state.currentPreviewIndex]?.enabled) state.currentPreviewIndex = enabledFrameIndexes()[0];
    updatePlayButton();
  }

  function stepFrame(direction) {
    state.playing = false;
    updatePlayButton();
    const next = nextFrameIndex(state.currentPreviewIndex, direction);
    if (next >= 0) {
      state.currentPreviewIndex = next;
      state.selectedIndex = next;
      updateInspector();
      renderPreview();
      renderSheet();
      renderTimeline();
    }
  }

  function animationLoop(timestamp) {
    if (state.playing) {
      const delta = timestamp - state.playLastTimestamp;
      state.playLastTimestamp = timestamp;
      state.playElapsed += delta;
      const frame = state.project.frames[state.currentPreviewIndex];
      if (!frame || !frame.enabled) {
        state.currentPreviewIndex = enabledFrameIndexes()[0] ?? -1;
        state.playElapsed = 0;
      } else if (state.playElapsed >= frameDuration(frame)) {
        state.playElapsed %= frameDuration(frame);
        const next = nextFrameIndex(state.currentPreviewIndex, 1);
        if (next === state.currentPreviewIndex && !state.project.playback.loop) {
          state.playing = false;
          updatePlayButton();
        } else {
          state.currentPreviewIndex = next;
          renderPreview();
          renderTimeline(false);
        }
      }
    }
    requestAnimationFrame(animationLoop);
  }

  function renderTimeline(rebuild = true) {
    if (!rebuild) {
      [...dom.timelineFrames.querySelectorAll('.frame-card')].forEach((card, index) => card.classList.toggle('active', index === state.currentPreviewIndex));
      return;
    }
    dom.timelineFrames.innerHTML = '';
    if (!state.project.frames.length) {
      dom.timelineFrames.innerHTML = '<div class="timeline-empty">フレームがありません。「追加」またはJSON読込で開始してください。</div>';
      return;
    }
    state.project.frames.forEach((frame, index) => {
      const card = document.createElement('div');
      card.className = `frame-card${index === state.selectedIndex ? ' active' : ''}${frame.enabled ? '' : ' disabled'}`;
      card.draggable = true;
      card.dataset.index = String(index);
      const thumb = document.createElement('div');
      thumb.className = 'frame-thumb';
      const canvas = document.createElement('canvas');
      renderThumbnail(canvas, frame);
      thumb.appendChild(canvas);
      const footer = document.createElement('footer');
      footer.innerHTML = `<span>${index + 1}</span><span>${frame.durationMs}ms</span>`;
      card.append(thumb, footer);
      card.title = frame.id;
      card.addEventListener('click', () => selectFrame(index));
      card.addEventListener('dragstart', (event) => {
        state.timelineDragIndex = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      });
      card.addEventListener('dragover', (event) => { event.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        card.classList.remove('drag-over');
        reorderFrame(state.timelineDragIndex, index);
      });
      dom.timelineFrames.appendChild(card);
    });
  }

  function renderThumbnail(canvas, frame) {
    const maxWidth = 96;
    const maxHeight = 50;
    const scale = Math.min(maxWidth / frame.source.width, maxHeight / frame.source.height, 2);
    canvas.width = Math.max(1, Math.round(frame.source.width * scale));
    canvas.height = Math.max(1, Math.round(frame.source.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.image) return;
    const processed = buildProcessedFrameCanvas(frame);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(processed, 0, 0, canvas.width, canvas.height);
  }

  function reorderFrame(from, to) {
    if (from == null || from === to || from < 0 || to < 0) return;
    pushUndo();
    const [frame] = state.project.frames.splice(from, 1);
    state.project.frames.splice(to, 0, frame);
    state.selectedIndex = to;
    state.currentPreviewIndex = to;
    state.timelineDragIndex = null;
    syncAfterMutation();
  }

  function saveJson() {
    const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, projectJsonFileName());
    toast('プロジェクトJSONを保存しました。');
  }

  function projectJsonFileName() {
    const base = (state.project.image?.fileName || 'animation').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'animation';
    return `${base}.celanchor.json`;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportZip() {
    const errors = updateValidationStatus();
    if (errors.length) { toast('JSONの問題を修正してから出力してください。', true); return; }
    if (!state.image) { toast('スプライトシートを選択してください。', true); return; }
    const frames = state.project.frames.filter((frame) => frame.enabled);
    if (!frames.length) { toast('有効なフレームがありません。', true); return; }
    setRuntimeStatus(`PNG生成中 0/${frames.length}`);
    dom.exportZipButton.disabled = true;
    try {
      const entries = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const canvas = renderExportFrame(frame);
        const blob = await canvasToBlob(canvas, 'image/png');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        entries.push({ name: formatFrameFileName(state.project.output.fileNamePattern, i + 1, frame), bytes });
        setRuntimeStatus(`PNG生成中 ${i + 1}/${frames.length}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (state.includeJsonInZip) {
        entries.push({ name: projectJsonFileName(), bytes: new TextEncoder().encode(JSON.stringify(state.project, null, 2)) });
      }
      const zipBytes = createZip(entries);
      const base = (state.project.image?.fileName || 'celanchor').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'celanchor';
      downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `${base}_frames.zip`);
      toast(`${frames.length}枚のPNGをZIP出力しました。`);
      setRuntimeStatus('Ready');
    } catch (error) {
      console.error(error);
      setRuntimeStatus('出力エラー');
      toast(`ZIP出力に失敗しました: ${error.message}`, true);
    } finally {
      dom.exportZipButton.disabled = false;
    }
  }

  function renderExportFrame(frame) {
    const canvas = document.createElement('canvas');
    canvas.width = state.project.output.width;
    canvas.height = state.project.output.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrameToContext(ctx, frame, 1);
    return canvas;
  }

  function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像Blobを生成できませんでした。')), type));
  }

  function formatFrameFileName(pattern, index, frame) {
    let name = pattern || 'frame_{index:03}.png';
    name = name.replace(/\{index(?::(\d+))?\}/g, (_, width) => String(index).padStart(width ? Number(width) : 1, '0'));
    name = name.replace(/\{id\}/g, frame.id.replace(/[^a-zA-Z0-9_-]+/g, '_'));
    if (!name.toLowerCase().endsWith('.png')) name += '.png';
    return name.replace(/[\\/:*?"<>|]+/g, '_');
  }

  function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosDate, dosTime } = getDosDateTime(new Date());
    entries.forEach((entry) => {
      const nameBytes = new TextEncoder().encode(entry.name);
      const crc = crc32(entry.bytes);
      const local = new Uint8Array(30 + nameBytes.length + entry.bytes.length);
      const view = new DataView(local.buffer);
      writeU32(view, 0, 0x04034b50);
      writeU16(view, 4, 20);
      writeU16(view, 6, 0x0800);
      writeU16(view, 8, 0);
      writeU16(view, 10, dosTime);
      writeU16(view, 12, dosDate);
      writeU32(view, 14, crc);
      writeU32(view, 18, entry.bytes.length);
      writeU32(view, 22, entry.bytes.length);
      writeU16(view, 26, nameBytes.length);
      writeU16(view, 28, 0);
      local.set(nameBytes, 30);
      local.set(entry.bytes, 30 + nameBytes.length);
      localParts.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      writeU32(centralView, 0, 0x02014b50);
      writeU16(centralView, 4, 20);
      writeU16(centralView, 6, 20);
      writeU16(centralView, 8, 0x0800);
      writeU16(centralView, 10, 0);
      writeU16(centralView, 12, dosTime);
      writeU16(centralView, 14, dosDate);
      writeU32(centralView, 16, crc);
      writeU32(centralView, 20, entry.bytes.length);
      writeU32(centralView, 24, entry.bytes.length);
      writeU16(centralView, 28, nameBytes.length);
      writeU16(centralView, 30, 0);
      writeU16(centralView, 32, 0);
      writeU16(centralView, 34, 0);
      writeU16(centralView, 36, 0);
      writeU32(centralView, 38, 0);
      writeU32(centralView, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length;
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeU32(endView, 0, 0x06054b50);
    writeU16(endView, 4, 0);
    writeU16(endView, 6, 0);
    writeU16(endView, 8, entries.length);
    writeU16(endView, 10, entries.length);
    writeU32(endView, 12, centralSize);
    writeU32(endView, 16, offset);
    writeU16(endView, 20, 0);
    return concatBytes([...localParts, ...centralParts, end]);
  }

  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => { output.set(part, offset); offset += part.length; });
    return output;
  }
  function getDosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function setupEvents() {
    dom.imageInput.addEventListener('change', () => loadImageFile(dom.imageInput.files[0]));
    dom.jsonFileInput.addEventListener('change', () => loadJsonFile(dom.jsonFileInput.files[0]));
    dom.saveJsonButton.addEventListener('click', saveJson);
    dom.exportZipButton.addEventListener('click', exportZip);
    dom.addFrameButton.addEventListener('click', addFrame);
    dom.duplicateFrameButton.addEventListener('click', duplicateFrame);
    dom.deleteFrameButton.addEventListener('click', deleteFrame);
    dom.fitSheetButton.addEventListener('click', fitSheet);
    dom.actualSizeButton.addEventListener('click', actualSize);
    dom.previousFrameButton.addEventListener('click', () => stepFrame(-1));
    dom.nextFrameButton.addEventListener('click', () => stepFrame(1));
    dom.playButton.addEventListener('click', togglePlay);
    dom.previewScaleSelect.addEventListener('change', () => { state.previewScale = Number(dom.previewScaleSelect.value); renderPreview(); });
    dom.showGuidesInput.addEventListener('change', () => { state.showGuides = dom.showGuidesInput.checked; renderPreview(); });
    dom.onionSkinInput.addEventListener('change', () => { state.onionSkin = dom.onionSkinInput.checked; renderPreview(); });
    dom.applyJsonButton.addEventListener('click', () => applyJsonText(dom.jsonEditor.value));
    dom.formatJsonButton.addEventListener('click', () => {
      try { dom.jsonEditor.value = JSON.stringify(JSON.parse(dom.jsonEditor.value), null, 2); toast('JSONを整形しました。'); }
      catch (error) { toast(`JSON構文エラー: ${error.message}`, true); }
    });
    dom.copyJsonButton.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(dom.jsonEditor.value); toast('JSONをコピーしました。'); }
      catch { dom.jsonEditor.select(); document.execCommand('copy'); toast('JSONをコピーしました。'); }
    });
    dom.undoButton.addEventListener('click', undo);
    dom.redoButton.addEventListener('click', redo);

    dom.sheetCanvasWrap.addEventListener('pointerdown', startSheetDrag);
    dom.sheetCanvasWrap.addEventListener('pointermove', moveSheetDrag);
    dom.sheetCanvasWrap.addEventListener('pointerup', endSheetDrag);
    dom.sheetCanvasWrap.addEventListener('pointercancel', endSheetDrag);
    dom.sheetCanvasWrap.addEventListener('wheel', zoomSheet, { passive: false });
    dom.sheetCanvasWrap.addEventListener('keydown', keyboardSheet);

    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        event.preventDefault(); togglePlay();
      }
    });

    new ResizeObserver(resizeSheetCanvas).observe(dom.sheetCanvasWrap);
  }

  async function tryLoadBundledSample() {
    try {
      const [jsonResponse, imageResponse] = await Promise.all([fetch('sample.celanchor.json'), fetch('sample-sheet.png')]);
      if (!jsonResponse.ok || !imageResponse.ok) return;
      const project = await jsonResponse.json();
      const blob = await imageResponse.blob();
      const file = new File([blob], 'sample-sheet.png', { type: blob.type });
      state.project = normalizeProject(project);
      state.selectedIndex = 0;
      state.currentPreviewIndex = 0;
      syncJsonText();
      await loadImageFile(file);
      toast('サンプルプロジェクトを読み込みました。画像やJSONを差し替えて使用できます。');
    } catch {
      // file:// 直開きでは fetch が制限されるため、空のプロジェクトで開始する。
    }
  }

  function init() {
    setupTabs();
    bindInputs();
    setupEvents();
    refreshAll();
    requestAnimationFrame(animationLoop);
    tryLoadBundledSample();
  }

  init();
})();
