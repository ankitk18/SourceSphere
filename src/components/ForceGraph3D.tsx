"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  z: number;
  path: string;
}

export interface GraphLink {
  source: string;
  target: string;
}

interface ForceGraph3DProps {
  nodes: GraphNode[];
  links?: GraphLink[];
  /** Optional index of the node to highlight (pulse + camera target). */
  highlightedIndex?: number | null;
}

/**
 * A small deterministic hash so files in the same directory get the same color.
 */
function directoryColor(path: string): string {
  const trimmed = path.replace(/^\//, '');
  const dir = trimmed.includes('/')
    ? trimmed.substring(0, trimmed.lastIndexOf('/'))
    : '.';

  const palette = [
    '#ff3333', // red
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#d946ef', // fuchsia
    '#14b8a6', // teal
    '#6366f1', // indigo
    '#ef4444', // red-500
    '#22c55e', // green
    '#eab308', // yellow
  ];

  let hash = 0;
  for (let i = 0; i < dir.length; i++) {
    hash = (hash << 5) - hash + dir.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

/**
 * Build a circular canvas sprite that is always visible regardless of lighting.
 */
function createNodeSprite(color: string, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const center = size / 2;

  // Outer glow.
  const glow = ctx.createRadialGradient(
    center,
    center,
    size * 0.15,
    center,
    center,
    size * 0.5,
  );
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Solid core.
  ctx.beginPath();
  ctx.arc(center, center, size * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, size * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  return canvas;
}

/**
 * Try to create a WebGL renderer with graceful fallbacks.
 */
function createWebGLRenderer(
  width: number,
  height: number,
): THREE.WebGLRenderer | null {
  const baseOptions: THREE.WebGLRendererParameters = {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  };

  const fallbackOptions: THREE.WebGLRendererParameters = {
    antialias: false,
    alpha: false,
    powerPreference: "default",
  };

  for (const options of [baseOptions, fallbackOptions]) {
    try {
      const renderer = new THREE.WebGLRenderer(options);
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      return renderer;
    } catch (err) {
      console.warn("WebGL renderer creation failed, trying fallback:", err);
    }
  }

  return null;
}

export default function CodeForceGraph({
  nodes,
  links = [],
  highlightedIndex,
}: ForceGraph3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipPathRef = useRef<HTMLDivElement | null>(null);
  const tooltipCoordsRef = useRef<HTMLDivElement | null>(null);

  const [webglError, setWebglError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string>("");

  // Persist camera state across node updates so user interactions are not reset.
  const cameraStateRef = useRef<{
    position?: THREE.Vector3;
    target?: THREE.Vector3;
  }>({});

  // Track the currently hovered node id directly to avoid React-state flicker.
  const hoveredIdRef = useRef<string | null>(null);

  // Track which node should be pulsed from an external search result.
  const highlightIdRef = useRef<string | null>(null);
  const highlightStartRef = useRef<number | null>(null);

  // Latest pointer position and whether it is inside the graph container.
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerInsideRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    const container = containerRef.current;
    let isActive = true;
    let animationId: number | null = null;

    const cleanupFns: Array<() => void> = [];

    const init = async () => {
      const [{ OrbitControls }] = await Promise.all([
        import("three/examples/jsm/controls/OrbitControls.js"),
      ]);

      if (!isActive || !container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#020617");

      const camera = new THREE.PerspectiveCamera(
        60,
        width / height,
        0.1,
        100000,
      );

      const renderer = createWebGLRenderer(width, height);
      if (!renderer) {
        setWebglError(
          "Unable to create a WebGL context. Your browser or device may not support WebGL, or too many WebGL contexts are already open.",
        );
        return;
      }
      setWebglError(null);
      container.appendChild(renderer.domElement);
      cleanupFns.push(() => {
        try {
          container.removeChild(renderer.domElement);
        } catch {
          // ignore
        }
        renderer.dispose();
        try {
          renderer.forceContextLoss();
        } catch {
          // ignore
        }
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.enablePan = true;
      controls.zoomSpeed = 1.0;
      controls.rotateSpeed = 1.0;

      // Handle external search highlight: move camera to the node and start pulse.
      if (
        typeof highlightedIndex === "number" &&
        highlightedIndex >= 0 &&
        highlightedIndex < nodes.length
      ) {
        const targetNode = nodes[highlightedIndex];
        const target = new THREE.Vector3(targetNode.x, targetNode.y, targetNode.z);
        camera.position.set(target.x + 120, target.y + 120, target.z + 120);
        controls.target.copy(target);
        controls.update();
        highlightIdRef.current = targetNode.id;
        highlightStartRef.current = performance.now();
      } else {
        highlightIdRef.current = null;
        highlightStartRef.current = null;
      }

      // Track whether user is interacting with the camera so hover is paused
      // during drag/zoom/pan and the tooltip clears immediately.
      let isInteracting = false;
      const clearHover = () => {
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          const tooltip = tooltipRef.current;
          if (tooltip) tooltip.style.display = "none";
        }
      };
      const onControlsStart = () => {
        isInteracting = true;
        clearHover();
      };
      const onControlsEnd = () => {
        isInteracting = false;
      };
      controls.addEventListener("start", onControlsStart);
      controls.addEventListener("end", onControlsEnd);
      cleanupFns.push(() => {
        controls.dispose();
      });

      // Build a bounding box from the node coordinates so we can place the
      // camera where it can actually see every node.
      const box = new THREE.Box3();
      nodes.forEach((node) =>
        box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z)),
      );
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const distance = (maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360);

      if (cameraStateRef.current.position && cameraStateRef.current.target) {
        camera.position.copy(cameraStateRef.current.position);
        controls.target.copy(cameraStateRef.current.target);
      } else {
        camera.position.set(
          center.x + distance * 1.5,
          center.y + distance * 1.2,
          center.z + distance * 1.5,
        );
        camera.lookAt(center);
        controls.target.copy(center);
      }
      controls.update();

      // Save camera state whenever the user moves/zooms/rotates.
      const saveCameraState = () => {
        cameraStateRef.current.position = camera.position.clone();
        cameraStateRef.current.target = controls.target.clone();
      };
      controls.addEventListener("change", saveCameraState);
      cleanupFns.push(() =>
        controls.removeEventListener("change", saveCameraState),
      );

      // Build a shared material cache per directory color so all files in the
      // same directory use the same sprite material.
      const materialCache = new Map<string, THREE.SpriteMaterial>();
      function getMaterial(color: string) {
        if (materialCache.has(color)) return materialCache.get(color)!;
        const canvas = createNodeSprite(color, 128);
        const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
        const mat = new THREE.SpriteMaterial({
          map: tex,
          color: 0xffffff,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        materialCache.set(color, mat);
        return mat;
      }

      // Highlight sprite material (gold glow).
      const highlightCanvas = createNodeSprite("#fbbf24", 192);
      const highlightTexture = highlightCanvas
        ? new THREE.CanvasTexture(highlightCanvas)
        : null;
      const highlightMaterial = new THREE.SpriteMaterial({
        map: highlightTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      cleanupFns.push(() => {
        materialCache.forEach((mat) => {
          mat.map?.dispose();
          mat.dispose();
        });
        materialCache.clear();
        if (highlightCanvas) highlightTexture?.dispose();
        highlightMaterial.dispose();
      });

      // Invisible hit targets sized to match the visible sprite (roughly).
      const hitGeometry = new THREE.SphereGeometry(18, 16, 16);
      const hitMaterial = new THREE.MeshBasicMaterial({
        visible: false,
        transparent: true,
        opacity: 0,
      });
      cleanupFns.push(() => {
        hitGeometry.dispose();
        hitMaterial.dispose();
      });

      const nodeById = new Map<string, GraphNode>();
      const hitObjects: THREE.Mesh[] = [];
      const nodeSprites = new Map<string, THREE.Sprite>();

      nodes.forEach((node) => {
        nodeById.set(node.id, node);
        const color = directoryColor(node.path);

        // Visible sprite.
        const sprite = new THREE.Sprite(getMaterial(color));
        sprite.position.set(node.x, node.y, node.z);
        sprite.scale.set(28, 28, 1);
        scene.add(sprite);
        nodeSprites.set(node.id, sprite);

        // Invisible sphere for reliable raycasting.
        const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
        hitMesh.position.set(node.x, node.y, node.z);
        hitMesh.userData = { node };
        scene.add(hitMesh);
        hitObjects.push(hitMesh);
      });

      // Render optional links.
      if (links.length > 0) {
        const positions: number[] = [];
        links.forEach((link) => {
          const source = nodeById.get(link.source);
          const target = nodeById.get(link.target);
          if (source && target) {
            positions.push(
              source.x,
              source.y,
              source.z,
              target.x,
              target.y,
              target.z,
            );
          }
        });
        if (positions.length > 0) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3),
          );
          const material = new THREE.LineBasicMaterial({
            color: "#334155",
            transparent: true,
            opacity: 0.4,
          });
          scene.add(new THREE.LineSegments(geometry, material));
          cleanupFns.push(() => {
            geometry.dispose();
            material.dispose();
          });
        }
      }

      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();

      // Listen on the canvas so OrbitControls gets pointer capture, but still
      // update our tracking refs so the animation loop can raycast smoothly.
      const onPointerMove = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current = { x: event.clientX, y: event.clientY };
        ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        pointerInsideRef.current = true;
      };

      const onPointerLeave = () => {
        pointerInsideRef.current = false;
        clearHover();
      };

      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerleave", onPointerLeave);
      cleanupFns.push(() => {
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      });

      const onClick = (event: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);
        const intersects = raycaster.intersectObjects(hitObjects);
        if (intersects.length > 0) {
          const node = intersects[0].object.userData.node as GraphNode;
          const target = new THREE.Vector3(node.x, node.y, node.z);
          controls.target.copy(target);
          camera.position.set(target.x + 120, target.y + 120, target.z + 120);
          controls.update();
        }
      };
      renderer.domElement.addEventListener("click", onClick);
      cleanupFns.push(() => renderer.domElement.removeEventListener("click", onClick));

      const onResize = () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
      };
      window.addEventListener("resize", onResize);
      cleanupFns.push(() => window.removeEventListener("resize", onResize));

      // Handle context loss gracefully.
      const onContextLost = (event: Event) => {
        event.preventDefault();
        setWebglError("WebGL context was lost. Try reloading the page.");
        isActive = false;
      };
      renderer.domElement.addEventListener("webglcontextlost", onContextLost);
      cleanupFns.push(() =>
        renderer.domElement.removeEventListener("webglcontextlost", onContextLost),
      );

      const animate = () => {
        if (!isActive) return;
        animationId = requestAnimationFrame(animate);
        controls.update();

        // Pulse the highlighted search result node.
        if (highlightIdRef.current && highlightStartRef.current !== null) {
          const highlightSprite = nodeSprites.get(highlightIdRef.current);
          if (highlightSprite) {
            const elapsed = performance.now() - highlightStartRef.current;
            // 1.5 second pulse, loops 3 times then settles to gold.
            const pulse = Math.sin((elapsed / 150) * Math.PI * 2);
            const scale = 28 + pulse * 18;
            highlightSprite.material = highlightMaterial;
            highlightSprite.scale.set(scale, scale, 1);
            if (elapsed > 3000) {
              highlightStartRef.current = null;
              highlightSprite.scale.set(36, 36, 1);
            }
          }
        }

        // Only raycast when the pointer is inside the canvas and the user is
        // not dragging/zooming/panning. Show the tooltip only when a node is
        // actually hit, and hide it immediately when nothing is hit.
        if (pointerInsideRef.current && !isInteracting) {
          raycaster.setFromCamera(ndc, camera);
          const intersects = raycaster.intersectObjects(hitObjects);

          if (intersects.length > 0) {
            const hit = intersects[0].object.userData.node as GraphNode;
            if (hoveredIdRef.current !== hit.id) {
              hoveredIdRef.current = hit.id;
              const tooltip = tooltipRef.current;
              if (tooltip) {
                tooltip.style.display = "block";
                tooltip.style.left = `${pointerRef.current.x}px`;
                tooltip.style.top = `${pointerRef.current.y - 24}px`;
              }
              if (tooltipPathRef.current) {
                tooltipPathRef.current.textContent = hit.path;
              }
              if (tooltipCoordsRef.current) {
                tooltipCoordsRef.current.textContent =
                  `X: ${hit.x.toFixed(1)}  Y: ${hit.y.toFixed(1)}  Z: ${hit.z.toFixed(1)}`;
              }
            } else {
              const tooltip = tooltipRef.current;
              if (tooltip) {
                tooltip.style.left = `${pointerRef.current.x}px`;
                tooltip.style.top = `${pointerRef.current.y - 24}px`;
              }
            }
          } else {
            clearHover();
          }
        }

        renderer.render(scene, camera);
      };
      animate();
      cleanupFns.push(() => {
        if (animationId !== null) cancelAnimationFrame(animationId);
      });

      setDebug(`nodes=${nodes.length}, framed`);
    };

    init();

    return () => {
      isActive = false;
      if (animationId !== null) cancelAnimationFrame(animationId);
      cleanupFns.forEach((fn) => {
        try {
          fn();
        } catch {
          // ignore
        }
      });
      hoveredIdRef.current = null;
      highlightIdRef.current = null;
      highlightStartRef.current = null;
      const tooltip = tooltipRef.current;
      if (tooltip) tooltip.style.display = "none";
    };
  }, [nodes, links, highlightedIndex]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/50 text-slate-400">
        Upload files and generate 3D coordinates to visualize the graph.
      </div>
    );
  }

  if (webglError) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/50 px-8 text-center text-slate-400">
        {webglError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-[600px] w-full cursor-move overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl"
    >
      {/* Tooltip is updated directly via refs inside the animation loop. */}
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-50 hidden max-w-xs rounded-xl border border-slate-700/80 bg-slate-900/90 px-4 py-2 text-sm text-white shadow-[0_0_25px_rgba(99,102,241,0.25)] backdrop-blur-sm"
        style={{ transform: "translate(-50%, -100%)" }}
      >
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-400">
          File
        </div>
        <div
          ref={tooltipPathRef}
          className="break-all font-mono text-xs text-slate-200"
        />
        <div
          ref={tooltipCoordsRef}
          className="mt-1.5 flex gap-2 text-[10px] text-slate-500"
        />
      </div>

      <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2 backdrop-blur-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
          Code Galaxy
        </p>
        <p className="text-[10px] text-slate-400">
          {nodes.length} nodes · drag to rotate · scroll to zoom · hover for
          details
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2 backdrop-blur-sm text-[10px] text-slate-400">
        debug: {debug}
      </div>
    </div>
  );
}
