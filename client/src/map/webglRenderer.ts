import type { Unit, UnitDelta } from '@shared/types';

// ---------------------------------------------------------------------------
// WebGL2 Instanced Unit Renderer
// Draws all 20,000 units in 3 draw calls (one per shape type).
// Falls back gracefully to null if WebGL2 is unavailable.
// ---------------------------------------------------------------------------

// colorId encoding (matches fragment shader)
// 0=alpha-blue  1=bravo-red  2=attacking-amber  3=damaged-orange  4=dead-gray
const COLOR_ALPHA    = 0;
const COLOR_BRAVO    = 1;
const COLOR_ATTACK   = 2;
const COLOR_DAMAGED  = 3;
const COLOR_DEAD     = 4;
const LOW_HP = 25;

function unitColorId(u: Unit): number {
  if (u.status === 'destroyed')  return COLOR_DEAD;
  if (u.status === 'attacking')  return COLOR_ATTACK;
  if (u.health < LOW_HP)         return COLOR_DAMAGED;
  return u.team === 'alpha' ? COLOR_ALPHA : COLOR_BRAVO;
}

// ---------------------------------------------------------------------------
// Base mesh vertices (local NDC coords, unit size = 1.0, scaled by shader)
// ---------------------------------------------------------------------------

// Infantry: filled square, 2 triangles
const SQUARE_VERTS = new Float32Array([
  -0.5, -0.5,   0.5, -0.5,   0.5,  0.5,
  -0.5, -0.5,   0.5,  0.5,  -0.5,  0.5,
]);

// Vehicle: plus/cross — two overlapping quads (horizontal + vertical)
const CROSS_VERTS = new Float32Array([
  // horizontal bar (full width, 1/3 height)
  -0.5, -0.18,   0.5, -0.18,   0.5,  0.18,
  -0.5, -0.18,   0.5,  0.18,  -0.5,  0.18,
  // vertical bar (1/3 width, full height)
  -0.18, -0.5,   0.18, -0.5,   0.18,  0.5,
  -0.18, -0.5,   0.18,  0.5,  -0.18,  0.5,
]);

// Air: upward-pointing triangle
const TRIANGLE_VERTS = new Float32Array([
   0.0,  0.55,   -0.5, -0.45,   0.5, -0.45,
]);

// ---------------------------------------------------------------------------
// GLSL Shaders
// ---------------------------------------------------------------------------

const VERT_SRC = /* glsl */`#version 300 es
precision highp float;

// Per-vertex (base mesh)
in vec2 a_vertex;

// Per-instance
in vec2  a_pos;      // unit position in [0,1] map space
in float a_color;    // colorId float

// Uniforms
uniform vec2  u_canvas;    // canvas size in pixels
uniform float u_zoom;
uniform vec2  u_vp;        // viewport centre (cx, cy)
uniform float u_size;      // unit size in pixels

out float v_color;

void main() {
  // Map [0,1] → screen pixels with zoom+pan
  vec2 screen = ((a_pos - u_vp) * u_zoom + 0.5) * u_canvas;

  // Local shape vertex scaled to pixels
  vec2 local = a_vertex * u_size;

  // Final pixel position → WebGL NDC (Y-flipped)
  vec2 ndc = ((screen + local) / u_canvas) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);

  v_color = a_color;
}
`;

const FRAG_SRC = /* glsl */`#version 300 es
precision mediump float;

in float v_color;
out vec4 fragColor;

void main() {
  int c = int(v_color + 0.5);
  if      (c == 0) fragColor = vec4(0.231, 0.510, 0.965, 1.0); // alpha blue  #3b82f6
  else if (c == 1) fragColor = vec4(0.937, 0.267, 0.267, 1.0); // bravo red   #ef4444
  else if (c == 2) fragColor = vec4(0.961, 0.620, 0.043, 1.0); // attack amber #f59e0b
  else if (c == 3) fragColor = vec4(0.976, 0.451, 0.086, 1.0); // damaged orange #f97316
  else             fragColor = vec4(0.314, 0.314, 0.353, 0.5); // dead gray
}
`;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface ShapeBatch {
  vao:         WebGLVertexArrayObject;
  meshVBO:     WebGLBuffer;
  instanceVBO: WebGLBuffer;
  vertCount:   number;
  // Contiguous region of instanceData for this shape type
  baseSlot:    number;   // start index in instanceData (in units of 3 floats)
  count:       number;   // live instance count
}

// Per-instance layout: [x, y, colorId] = 3 floats = 12 bytes
const FLOATS_PER_INSTANCE = 3;
const BYTES_PER_INSTANCE  = FLOATS_PER_INSTANCE * 4;
const MAX_UNITS = 20_000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WebGLUnitRenderer {
  loadSnapshot(units: Map<string, Unit>): void;
  applyDeltas(deltas: UnitDelta[], units: Map<string, Unit>): void;
  drawUnits(
    viewport: { zoom: number; cx: number; cy: number },
    W: number,
    H: number,
    unitSize: number,
  ): void;
  resize(W: number, H: number): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
): WebGLUnitRenderer | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false });
  if (!gl) return null;

  // --- Compile shaders ---
  function compileShader(type: number, src: string): WebGLShader {
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile error');
    return s;
  }

  const vert = compileShader(gl.VERTEX_SHADER,   VERT_SRC);
  const frag = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  // --- Uniform locations ---
  const uCanvas = gl.getUniformLocation(prog, 'u_canvas')!;
  const uZoom   = gl.getUniformLocation(prog, 'u_zoom')!;
  const uVp     = gl.getUniformLocation(prog, 'u_vp')!;
  const uSize   = gl.getUniformLocation(prog, 'u_size')!;

  // --- Attrib locations ---
  const aVertex = gl.getAttribLocation(prog, 'a_vertex');
  const aPos    = gl.getAttribLocation(prog, 'a_pos');
  const aColor  = gl.getAttribLocation(prog, 'a_color');

  // --- Shared instance buffer (all 3 shape types, contiguous) ---
  // Layout: [infantry 0..MAX/3-1 | vehicle MAX/3..2*MAX/3-1 | air 2*MAX/3..MAX-1]
  const MAX_PER_TYPE = Math.ceil(MAX_UNITS / 3) + 1; // ~6667 per type
  const instanceData = new Float32Array(MAX_PER_TYPE * 3 * FLOATS_PER_INSTANCE);

  const sharedInstanceBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, sharedInstanceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);

  // --- Build VAO for one shape type ---
  function buildBatch(meshVerts: Float32Array, baseSlot: number): ShapeBatch {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Mesh VBO (static)
    const meshVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVBO);
    gl.bufferData(gl.ARRAY_BUFFER, meshVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aVertex);
    gl.vertexAttribPointer(aVertex, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aVertex, 0); // per vertex

    // Instance VBO (shared, with byte offset per type)
    gl.bindBuffer(gl.ARRAY_BUFFER, sharedInstanceBuf);
    const byteOffset = baseSlot * FLOATS_PER_INSTANCE * 4;

    // a_pos: offset 0 within instance record
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, byteOffset);
    gl.vertexAttribDivisor(aPos, 1);

    // a_color: offset 8 bytes (after x,y)
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 1, gl.FLOAT, false, BYTES_PER_INSTANCE, byteOffset + 8);
    gl.vertexAttribDivisor(aColor, 1);

    gl.bindVertexArray(null);

    return {
      vao,
      meshVBO,
      instanceVBO: sharedInstanceBuf,
      vertCount: meshVerts.length / 2,
      baseSlot,
      count: 0,
    };
  }

  const infantryBatch = buildBatch(SQUARE_VERTS,   0);
  const vehicleBatch  = buildBatch(CROSS_VERTS,    MAX_PER_TYPE);
  const airBatch      = buildBatch(TRIANGLE_VERTS, MAX_PER_TYPE * 2);

  // --- Unit slot mapping ---
  // Each unit gets a fixed slot within its type's segment
  const unitSlotMap = new Map<string, number>(); // unitId → absolute slot index in instanceData

  // Per-type free slot counters (used during loadSnapshot only)
  let infantryNext = infantryBatch.baseSlot;
  let vehicleNext  = vehicleBatch.baseSlot;
  let airNext      = airBatch.baseSlot;

  function writeSlot(slot: number, u: Unit): void {
    const base = slot * FLOATS_PER_INSTANCE;
    instanceData[base]     = u.x;
    instanceData[base + 1] = u.y;
    instanceData[base + 2] = unitColorId(u);
  }

  // --- Public API ---

  function loadSnapshot(units: Map<string, Unit>): void {
    unitSlotMap.clear();
    infantryBatch.count = 0;
    vehicleBatch.count  = 0;
    airBatch.count      = 0;
    infantryNext = infantryBatch.baseSlot;
    vehicleNext  = vehicleBatch.baseSlot;
    airNext      = airBatch.baseSlot;

    for (const u of units.values()) {
      let slot: number;
      if (u.type === 'infantry') {
        slot = infantryNext++;
        infantryBatch.count++;
      } else if (u.type === 'vehicle') {
        slot = vehicleNext++;
        vehicleBatch.count++;
      } else {
        slot = airNext++;
        airBatch.count++;
      }
      unitSlotMap.set(u.id, slot);
      writeSlot(slot, u);
    }

    // Upload full buffer once
    gl.bindBuffer(gl.ARRAY_BUFFER, sharedInstanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);
  }

  // Dirty slot tracking (reused, no allocation per delta)
  const dirtySlots = new Set<number>();

  function applyDeltas(deltas: UnitDelta[], units: Map<string, Unit>): void {
    for (const delta of deltas) {
      const slot = unitSlotMap.get(delta.id);
      if (slot === undefined) continue;
      const u = units.get(delta.id);
      if (!u) continue;
      writeSlot(slot, u);
      dirtySlots.add(slot);
    }

    if (dirtySlots.size === 0) return;

    // Upload only dirty slots — group into contiguous ranges to minimize bufferSubData calls
    gl.bindBuffer(gl.ARRAY_BUFFER, sharedInstanceBuf);
    let rangeStart = -1;
    let rangeEnd   = -1;

    const sortedSlots = Array.from(dirtySlots).sort((a, b) => a - b);
    for (const slot of sortedSlots) {
      if (rangeStart === -1) {
        rangeStart = rangeEnd = slot;
      } else if (slot === rangeEnd + 1) {
        rangeEnd = slot;
      } else {
        // flush current range
        const byteOff = rangeStart * FLOATS_PER_INSTANCE * 4;
        const subView = instanceData.subarray(
          rangeStart * FLOATS_PER_INSTANCE,
          (rangeEnd + 1) * FLOATS_PER_INSTANCE,
        );
        gl.bufferSubData(gl.ARRAY_BUFFER, byteOff, subView);
        rangeStart = rangeEnd = slot;
      }
    }
    // flush last range
    if (rangeStart !== -1) {
      const byteOff = rangeStart * FLOATS_PER_INSTANCE * 4;
      const subView = instanceData.subarray(
        rangeStart * FLOATS_PER_INSTANCE,
        (rangeEnd + 1) * FLOATS_PER_INSTANCE,
      );
      gl.bufferSubData(gl.ARRAY_BUFFER, byteOff, subView);
    }

    dirtySlots.clear();
  }

  function drawUnits(
    vp: { zoom: number; cx: number; cy: number },
    W: number,
    H: number,
    unitSize: number,
  ): void {
    gl.viewport(0, 0, W, H);
    // Clear to solid dark background (#0d1117 = 13,17,23)
    gl.clearColor(13 / 255, 17 / 255, 23 / 255, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    gl.uniform2f(uCanvas, W, H);
    gl.uniform1f(uZoom,   vp.zoom);
    gl.uniform2f(uVp,     vp.cx, vp.cy);
    gl.uniform1f(uSize,   unitSize);

    for (const batch of [infantryBatch, vehicleBatch, airBatch]) {
      if (batch.count === 0) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.vertCount, batch.count);
    }

    gl.bindVertexArray(null);
  }

  function resize(W: number, H: number): void {
    canvas.width  = W;
    canvas.height = H;
  }

  function destroy(): void {
    gl.deleteBuffer(sharedInstanceBuf);
    for (const batch of [infantryBatch, vehicleBatch, airBatch]) {
      gl.deleteBuffer(batch.meshVBO);
      gl.deleteVertexArray(batch.vao);
    }
    gl.deleteProgram(prog);
  }

  return { loadSnapshot, applyDeltas, drawUnits, resize, destroy };
}
