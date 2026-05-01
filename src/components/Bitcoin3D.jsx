import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, PresentationControls, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

/** Textura opcional: coloca `chasflip-coin-face.png` en `public/` (ver `public/coin-face-SPECS.txt`). */
const CUSTOM_COIN_FACE_URL = '/chasflip-coin-face.png';

/**
 * Zoom UV en la cara: recorta borde oscuro/fondo del PNG para que el disco dorado llegue casi al címetro del cilindro.
 */
/** Zoom al centro del PNG: más valor = cara de la moneda más grande en el disco (recorta más borde). */
const COIN_FACE_UV_BORDER = 0.162;

/** Se aplica solo una vez al cargar desde disco (ClampToEdge + recorte centro). */
function prepareImportedCoinFaceTexture(texture) {
  const border = COIN_FACE_UV_BORDER;
  const m = Math.max(0.5, 1 - 2 * border);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(m, m);
  texture.offset.set(border, border);
  texture.center.set(0, 0);
  texture.needsUpdate = true;
}

/**
 * Procedural CHASFLIP coin face texture.
 * Never throws — returns null if the 2D context is unavailable.
 */
function makeCoinFaceTexture({ size = 512, mirror = false } = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.495;

  const base = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.05, cx, cy, R);
  base.addColorStop(0, '#fff2b1');
  base.addColorStop(0.35, '#f4cb55');
  base.addColorStop(0.7, '#d99c1f');
  base.addColorStop(1, '#7d550c');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  const hl = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.7);
  hl.addColorStop(0, 'rgba(255, 240, 200, 0.55)');
  hl.addColorStop(1, 'rgba(255, 240, 200, 0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(60, 38, 6, 0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(60, 38, 6, 0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.74, 0, Math.PI * 2);
  ctx.stroke();

  function curvedTextTop(text, radius, fontSize, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;
    ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const widths = [];
    let total = 0;
    for (let i = 0; i < text.length; i += 1) {
      const w = Math.max(0.01, ctx.measureText(text[i]).width);
      widths.push(w);
      total += w;
    }
    if (total <= 0) {
      ctx.restore();
      return;
    }
    const arcSpan = Math.PI * 1.05;
    let angle = -arcSpan / 2;
    for (let i = 0; i < text.length; i += 1) {
      const w = widths[i];
      const charAngle = (w / total) * arcSpan;
      ctx.save();
      ctx.rotate(angle + charAngle / 2);
      ctx.translate(0, -radius);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
      angle += charAngle;
    }
    ctx.restore();
  }

  function curvedTextBottom(text, radius, fontSize, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI);
    ctx.fillStyle = color;
    ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const widths = [];
    let total = 0;
    for (let i = 0; i < text.length; i += 1) {
      const w = Math.max(0.01, ctx.measureText(text[i]).width);
      widths.push(w);
      total += w;
    }
    if (total <= 0) {
      ctx.restore();
      return;
    }
    const arcSpan = Math.PI * 0.7;
    let angle = arcSpan / 2;
    for (let i = 0; i < text.length; i += 1) {
      const w = widths[i];
      const charAngle = (w / total) * arcSpan;
      ctx.save();
      ctx.rotate(angle - charAngle / 2);
      ctx.translate(0, -radius);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
      angle -= charAngle;
    }
    ctx.restore();
  }

  curvedTextTop(
    'CHASFLIP · BLOCKCHAIN BASADA EN LA INFRAESTRUCTURA DE BITCOIN',
    R * 0.83,
    14,
    'rgba(48, 30, 5, 0.92)',
  );

  curvedTextBottom(
    '© ARENA.JDX · ALL RIGHTS RESERVED',
    R * 0.83,
    13,
    'rgba(48, 30, 5, 0.88)',
  );

  ctx.save();
  ctx.translate(cx, cy);

  const cR = R * 0.36;
  const cThick = R * 0.115;
  ctx.strokeStyle = 'rgba(255, 230, 160, 0.55)';
  ctx.lineWidth = cThick;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(2, 2, cR, Math.PI * 0.18, Math.PI * 1.82);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(40, 24, 4, 0.95)';
  ctx.lineWidth = cThick;
  ctx.beginPath();
  ctx.arc(0, 0, cR, Math.PI * 0.18, Math.PI * 1.82);
  ctx.stroke();

  ctx.fillStyle = 'rgba(40, 24, 4, 0.95)';
  const slotW = cR * 0.85;
  const slotH = cThick * 0.32;
  ctx.fillRect(-slotW / 2, -cR + cThick * 0.05, slotW, slotH);

  ctx.restore();

  const vig = ctx.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vig;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  let outCanvas = canvas;
  if (mirror) {
    const mirrored = document.createElement('canvas');
    mirrored.width = size;
    mirrored.height = size;
    const mctx = mirrored.getContext('2d');
    if (!mctx) return canvas;
    mctx.translate(size, 0);
    mctx.scale(-1, 1);
    mctx.drawImage(canvas, 0, 0);
    outCanvas = mirrored;
  }

  try {
    const tex = new THREE.CanvasTexture(outCanvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    tex.anisotropy = 4;
    return tex;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Bitcoin3D] CanvasTexture failed', e);
    return null;
  }
}

function makeRimTexture({ width = 2048, height = 128, ridges = 220 } = {}) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#9d6f12');
  grad.addColorStop(0.5, '#e8b836');
  grad.addColorStop(1, '#7a5208');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const step = width / ridges;
  for (let i = 0; i < ridges; i += 1) {
    const x = i * step;
    ctx.fillStyle = 'rgba(40, 24, 4, 0.55)';
    ctx.fillRect(x, 0, step * 0.45, height);
    ctx.fillStyle = 'rgba(255, 235, 170, 0.45)';
    ctx.fillRect(x + step * 0.45, 0, step * 0.12, height);
  }

  try {
    const tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Bitcoin3D] rim texture failed', e);
    return null;
  }
}

/**
 * Si `customFaceMap` es una textura cargada (PNG/JPG), la usa en ambas tapas del cilindro.
 * Si no, usa las caras generadas por canvas (fallback).
 */
function buildCoinMaterials(customFaceMap) {
  let rimTex = null;
  try {
    rimTex = makeRimTexture();
  } catch {
    /* ignore */
  }

  let faceTex;
  let faceBackTex;

  if (customFaceMap) {
    const border = COIN_FACE_UV_BORDER;
    const m = Math.max(0.5, 1 - 2 * border);
    faceTex = customFaceMap;
    faceBackTex = customFaceMap.clone();
    faceBackTex.wrapS = THREE.ClampToEdgeWrapping;
    faceBackTex.wrapT = THREE.ClampToEdgeWrapping;
    faceBackTex.repeat.set(m, -m);
    faceBackTex.offset.set(border, border + m);
    if (THREE.SRGBColorSpace) faceBackTex.colorSpace = THREE.SRGBColorSpace;
    faceBackTex.needsUpdate = true;
  } else {
    try {
      faceTex = makeCoinFaceTexture({ mirror: false });
      faceBackTex = makeCoinFaceTexture({ mirror: true });
    } catch {
      /* ignore */
    }
  }

  const faceProps = customFaceMap
    ? {
        color: '#ffffff',
        metalness: 0.88,
        roughness: 0.32,
        envMapIntensity: 2.35,
        emissive: '#ffb020',
        emissiveIntensity: 0.14,
      }
    : {
        color: '#ffe39a',
        metalness: 1,
        roughness: 0.28,
        envMapIntensity: 1.35,
      };

  const rimProps = {
    color: '#f5d45a',
    metalness: 1,
    roughness: 0.36,
    envMapIntensity: 1.45,
  };

  const sideMat = new THREE.MeshStandardMaterial(rimProps);
  if (rimTex) sideMat.map = rimTex;

  const frontMat = new THREE.MeshStandardMaterial(faceProps);
  if (faceTex) frontMat.map = faceTex;

  const backMat = new THREE.MeshStandardMaterial(faceProps);
  if (faceBackTex) backMat.map = faceBackTex;

  return [sideMat, frontMat, backMat];
}

function FallbackCoinMesh({ girando }) {
  const meshRef = useRef();
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const v = girando ? 14 : 0.6;
    meshRef.current.rotation.y += delta * v;
  });
  return (
    <group ref={meshRef}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[3, 3, 0.42, 64, 1, false]} />
        <meshStandardMaterial color="#e8b836" metalness={1} roughness={0.32} envMapIntensity={1} />
      </mesh>
    </group>
  );
}

function Coin({ girando }) {
  const groupRef = useRef();
  /** undefined = cargando archivo; null = sin archivo/error; Texture = cara custom */
  const [customFace, setCustomFace] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      CUSTOM_COIN_FACE_URL,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        prepareImportedCoinFaceTexture(texture);
        setCustomFace(texture);
      },
      undefined,
      () => {
        if (!cancelled) setCustomFace(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const materials = useMemo(() => {
    try {
      const customMap = customFace instanceof THREE.Texture ? customFace : null;
      return buildCoinMaterials(customMap);
    } catch (e) {
      console.warn('[Bitcoin3D] material build failed', e);
      return null;
    }
  }, [customFace]);

  useEffect(
    () => () => {
      if (!materials) return;
      materials.forEach((m) => m.dispose?.());
    },
    [materials],
  );

  useFrame((_, delta) => {
    const target = groupRef.current || null;
    if (!target) return;
    const v = girando ? 14 : 0.6;
    target.rotation.y += delta * v;
  });

  if (!materials) return <FallbackCoinMesh girando={girando} />;

  return (
    <group ref={groupRef}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={materials} castShadow receiveShadow>
        <cylinderGeometry args={[3, 3, 0.42, 128, 1, false]} />
      </mesh>

      <mesh position={[0, 0, 0.21]} castShadow>
        <torusGeometry args={[3, 0.05, 16, 128]} />
        <meshStandardMaterial
          color="#fff2c4"
          metalness={1}
          roughness={0.18}
          envMapIntensity={1.95}
        />
      </mesh>
      <mesh position={[0, 0, -0.21]} castShadow>
        <torusGeometry args={[3, 0.05, 16, 128]} />
        <meshStandardMaterial
          color="#fff2c4"
          metalness={1}
          roughness={0.18}
          envMapIntensity={1.95}
        />
      </mesh>
    </group>
  );
}

export default function Bitcoin3D({ fase }) {
  const estaGirando = fase === 'jugando' || fase === 'buscando';

  return (
    <div className="coin-3d-stage">
      <div className="coin-3d-halo" aria-hidden />

      <Canvas
        camera={{ position: [0, 0, 14], fov: 32 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ambientLight intensity={0.88} />
        <directionalLight position={[6, 10, 8]} intensity={2.05} castShadow />
        <directionalLight position={[-4, -2, 6]} intensity={0.55} color="#fff5e6" castShadow={false} />
        <pointLight position={[-7, -1, 5]} intensity={1.05} color="#ffc266" distance={55} decay={2} />
        <pointLight position={[10, 5, 2]} intensity={0.72} color="#fff5e0" distance={48} decay={2} />
        <pointLight position={[0, 14, 4]} intensity={0.42} color="#ffffff" distance={55} decay={2} />

        <Suspense fallback={null}>
          <Environment preset="city" />
        </Suspense>

        <PresentationControls global config={{ mass: 2, tension: 500 }} snap>
          <Float speed={1.4} rotationIntensity={0.2} floatIntensity={0.35}>
            <Coin girando={estaGirando} />
          </Float>
        </PresentationControls>

        <ContactShadows
          position={[0, -3.4, 0]}
          opacity={0.5}
          scale={10}
          blur={2.5}
          far={4}
          color="#1a0e00"
        />
      </Canvas>
    </div>
  );
}
