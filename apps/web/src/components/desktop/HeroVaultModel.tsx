"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Renders assets/vault.glb, fixed and facing left — no idle rotation, no
// pointer parallax, per explicit request. Only ever mounted in the desktop
// hero's right column (hidden lg:block branch), so the mobile bundle and
// mobile UI are untouched.
export function HeroVaultModel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvas: HTMLCanvasElement = canvasEl;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.4, 6);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-4, 5, 4);
    key.castShadow = true;
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(4, 2, -3);
    scene.add(fill);

    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.16 })
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = -1.6;
    catcher.receiveShadow = true;
    scene.add(catcher);

    function renderFrame() {
      renderer.render(scene, camera);
    }

    const loader = new GLTFLoader();
    loader.load("/models/vault.glb", (gltf) => {
      const model = gltf.scene;
      model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      // Center and scale down — small, not the focal fill of the space.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 2.3 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));
      model.position.y -= 0.2;

      // Fixed — a partial turn toward the left, not a full profile.
      model.rotation.y = Math.PI / 6;

      scene.add(model);
      renderFrame();
    });

    function resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderFrame();
    }
    window.addEventListener("resize", resize);
    resize();

    return () => {
      window.removeEventListener("resize", resize);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
