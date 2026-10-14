// tslint:disable
/* eslint-disable */
import React, { useRef, useMemo, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Float } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Physics, RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import { BOARD_SPACES, BoardSpaceConfig, getConfig } from './constants';
import {
  PlayerState,
  PropertyOwnership,
  CameraViewMode,
  FloatingText,
  JailEventState,
  CharacterCalibration,
} from './types';
import { gameAudio } from './utils/helper';

// Global scratch vectors to prevent runtime allocations in useFrame
const targetCamPos = new THREE.Vector3();
const targetCamLook = new THREE.Vector3();
const currentCamLook = new THREE.Vector3(0, 0, 0);

// Helper to calculate board coordinates for space index 0..31
export function getSpacePosition(index: number): [number, number, number] {
  const norm = ((index % 32) + 32) % 32;
  const HALF_SIZE = 8.8;
  const STEP = 2.2;

  // Bottom row: 0 to 7 (moving right: -X to +X, Z = +HALF_SIZE)
  if (norm >= 0 && norm <= 7) {
    const x = -HALF_SIZE + norm * STEP;
    return [x, 0.25, HALF_SIZE];
  }
  // Right col: 8 to 15 (moving back: +Z to -Z, X = +HALF_SIZE)
  if (norm >= 8 && norm <= 15) {
    const z = HALF_SIZE - (norm - 8) * STEP;
    return [HALF_SIZE, 0.25, z];
  }
  // Top row: 16 to 23 (moving left: +X to -X, Z = -HALF_SIZE)
  if (norm >= 16 && norm <= 23) {
    const x = HALF_SIZE - (norm - 16) * STEP;
    return [x, 0.25, -HALF_SIZE];
  }
  // Left col: 24 to 31 (moving forward: -Z to +Z, X = -HALF_SIZE)
  const z = -HALF_SIZE + (norm - 24) * STEP;
  return [-HALF_SIZE, 0.25, z];
}

// Board space orientation
export function getSpaceRotation(index: number): [number, number, number] {
  const norm = ((index % 32) + 32) % 32;
  if (norm >= 0 && norm < 8) return [0, 0, 0];
  if (norm >= 8 && norm < 16) return [0, -Math.PI / 2, 0];
  if (norm >= 16 && norm < 24) return [0, Math.PI, 0];
  return [0, Math.PI / 2, 0];
}

// Heading angle for clockwise traversal (+Z model facing forward)
export function getTravelHeading(index: number): number {
  const norm = ((index % 32) + 32) % 32;
  if (norm >= 0 && norm < 8) return Math.PI / 2; // Moving +X
  if (norm >= 8 && norm < 16) return Math.PI; // Moving -Z
  if (norm >= 16 && norm < 24) return -Math.PI / 2; // Moving -X
  return 0; // Moving +Z
}

// =========================================================================
// TEXTURE GENERATION UTILITIES FOR PROCEDURAL MASONRY, BRICK & WOOD
// =========================================================================

function createWeatheredBrickCanvasTexture(
  mainColor: string,
  altColor: string,
  mortarColor: string,
  stainColor?: string,
  rows = 24,
  cols = 12
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = mortarColor;
  ctx.fillRect(0, 0, 512, 512);

  const rowH = 512 / rows;
  const colW = 512 / cols;

  for (let r = 0; r < rows; r++) {
    const isShifted = r % 2 === 1;
    const offsetX = isShifted ? -colW / 2 : 0;
    for (let c = -1; c <= cols + 1; c++) {
      const bx = c * colW + offsetX + 1.5;
      const by = r * rowH + 1.5;
      const bw = colW - 3;
      const bh = rowH - 3;

      const noise = (Math.sin(r * 15.3 + c * 33.7) + Math.cos(r * 22.1 + c * 7.4) + 2) / 4;
      ctx.fillStyle = noise > 0.65 ? altColor : noise < 0.35 && stainColor ? stainColor : mainColor;
      ctx.fillRect(bx, by, bw, bh);

      // Micro-texture bevel highlights & subtle weathering
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(bx, by, bw, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(bx, by + bh - 1.5, bw, 1.5);
    }
  }

  // Weathering gradient from top to bottom
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(0,0,0,0.15)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function createSidewalkTileTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 0, 256, 256);

  // Concrete grid lines
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.strokeRect(132, 4, 120, 120);
  ctx.strokeRect(4, 132, 120, 120);
  ctx.strokeRect(132, 132, 120, 120);

  // Speckles
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 80; i++) {
    const rx = Math.random() * 256;
    const ry = Math.random() * 256;
    ctx.fillRect(rx, ry, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.needsUpdate = true;
  return tex;
}

// High-Resolution 1024x1024 Custom Urban Hip-Hop Emblem for the Dice Rolling Pit
function DicePitLogoTexture() {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 1. Deep Emerald Green Felt Circular Base
    const cx = 512;
    const cy = 512;
    const radius = 490;

    const bgGrad = ctx.createRadialGradient(cx, cy, 50, cx, cy, radius);
    bgGrad.addColorStop(0, '#065f46');
    bgGrad.addColorStop(0.7, '#064e3b');
    bgGrad.addColorStop(1, '#022c22');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Outer Gold Chain / Border Trim
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 12, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Stacks of Hundred-Dollar Bills (Backdrop)
    const drawCashStack = (x: number, y: number, w: number, h: number, angle: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((angle * Math.PI) / 180);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = '#064e3b';
        ctx.fillRect(-w / 2, -h / 2 - i * 5, w, h);
        ctx.fillStyle = '#10b981';
        ctx.fillRect(-w / 2 + 2, -h / 2 - i * 5 + 2, w - 4, h - 4);
        ctx.fillStyle = '#047857';
        ctx.strokeRect(-w / 2 + 6, -h / 2 - i * 5 + 6, w - 12, h - 12);
        ctx.fillStyle = '#022c22';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('$100', 0, -h / 2 - i * 5 + h / 2 + 8);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-16, -h / 2 - i * 5, 32, h);
      }
      ctx.restore();
    };

    drawCashStack(340, 270, 190, 85, -12);
    drawCashStack(680, 270, 190, 85, 14);
    drawCashStack(512, 230, 210, 95, 0);

    // 3. Golden Chess King Piece in the Center
    ctx.save();
    ctx.translate(512, 210);
    const goldGrad = ctx.createLinearGradient(-40, 0, 40, 0);
    goldGrad.addColorStop(0, '#78350f');
    goldGrad.addColorStop(0.3, '#fbbf24');
    goldGrad.addColorStop(0.6, '#fef08a');
    goldGrad.addColorStop(1, '#b45309');
    ctx.fillStyle = goldGrad;

    ctx.fillRect(-8, -110, 16, 32);
    ctx.fillRect(-20, -100, 40, 12);
    ctx.beginPath();
    ctx.arc(0, -70, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-24, -50);
    ctx.quadraticCurveTo(-14, 0, -36, 40);
    ctx.lineTo(36, 40);
    ctx.quadraticCurveTo(14, 0, 24, -50);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 45, 52, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Large 3D Gold Logo Banner: "HUSTLE CITY"
    ctx.save();
    ctx.translate(512, 470);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.roundRect(-420, -90, 840, 170, 30);
    ctx.fill();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 8;
    ctx.stroke();

    const text = 'HUSTLE CITY';
    ctx.font = '900 110px "Impact", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let d = 16; d > 0; d--) {
      ctx.fillStyle = '#78350f';
      ctx.fillText(text, 0, d - 8);
    }

    const textGrad = ctx.createLinearGradient(0, -60, 0, 40);
    textGrad.addColorStop(0, '#ffffff');
    textGrad.addColorStop(0.2, '#fef08a');
    textGrad.addColorStop(0.55, '#f59e0b');
    textGrad.addColorStop(0.9, '#d97706');
    textGrad.addColorStop(1, '#78350f');
    ctx.fillStyle = textGrad;
    ctx.fillText(text, 0, -10);

    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 5;
    ctx.strokeText(text, 0, -10);
    ctx.restore();

    // 5. Dynamic Microphone
    ctx.save();
    ctx.translate(512, 595);
    ctx.rotate((-10 * Math.PI) / 180);

    const micGrad = ctx.createLinearGradient(-150, 0, 100, 0);
    micGrad.addColorStop(0, '#090d16');
    micGrad.addColorStop(0.5, '#334155');
    micGrad.addColorStop(1, '#090d16');
    ctx.fillStyle = micGrad;
    ctx.beginPath();
    ctx.roundRect(-160, -18, 240, 36, 12);
    ctx.fill();

    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(100, 0, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    // 6. Signature Circular Emblem: "MR TALK OF NY"
    ctx.save();
    ctx.translate(512, 790);

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(0, 0, 145, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 5;
    ctx.strokeRect(-95, -95, 190, 190);

    ctx.fillStyle = '#fef08a';
    ctx.font = '900 36px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MR', 0, -55);

    ctx.fillStyle = '#facc15';
    ctx.font = '900 68px "Impact", "Arial Black", sans-serif';
    ctx.fillText('TALK', 0, 0);

    ctx.fillStyle = '#facc15';
    ctx.font = '900 64px "Impact", "Arial Black", sans-serif';
    ctx.fillText('OF NY', 0, 60);
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, []);

  if (!texture) return null;

  return (
    <mesh position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[2.2, 48]} />
      <meshStandardMaterial map={texture} roughness={0.4} metalness={0.15} />
    </mesh>
  );
}

// Canvas Text Texture Component for high-visibility sharp labels
function CanvasText({
  text,
  fontSize = 32,
  color = '#ffffff',
  width = 256,
  height = 64,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  bgColor,
}: {
  text: string;
  fontSize?: number;
  color?: string;
  width?: number;
  height?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  bgColor?: string;
}) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
      ctx.fillStyle = color;
      ctx.font = `900 ${fontSize}px "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, width / 2, height / 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [text, fontSize, color, width, height, bgColor]);

  if (!texture) return null;
  const aspect = width / height;
  const planeH = 0.55;
  const planeW = planeH * aspect;

  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial map={texture} transparent opacity={0.98} side={THREE.DoubleSide} />
    </mesh>
  );
}

// =========================================================================
// SECTION 1: REALISTIC HOUSE & ROOM ENVIRONMENT (Sunset Skyline Backdrop)
// =========================================================================
function RealisticHouseEnvironment() {
  return (
    <group position={[0, 0, 0]}>
      {/* 1. Warm Hardwood Parquet Floor */}
      <mesh position={[0, -7.2, 0]} receiveShadow>
        <boxGeometry args={[56, 0.4, 56]} />
        <meshStandardMaterial color="#3b1d0e" roughness={0.35} metalness={0.1} />
      </mesh>

      {/* Decorative Floor Inlay / Rug under Table */}
      <mesh position={[0, -6.98, 0]} receiveShadow>
        <boxGeometry args={[36, 0.02, 36]} />
        <meshStandardMaterial color="#1e1b4b" roughness={0.9} />
      </mesh>
      <mesh position={[0, -6.97, 0]}>
        <boxGeometry args={[34.5, 0.02, 34.5]} />
        <meshStandardMaterial color="#0f172a" roughness={0.85} />
      </mesh>
      <mesh position={[0, -6.96, 0]}>
        <boxGeometry args={[33.8, 0.02, 33.8]} />
        <meshStandardMaterial color="#312e81" roughness={0.9} />
      </mesh>

      {/* 2. Room Walls with Warm Wall Molding */}
      <mesh position={[0, 4.5, -24.5]} receiveShadow>
        <boxGeometry args={[56, 24, 0.6]} />
        <meshStandardMaterial color="#0f172a" roughness={0.85} />
      </mesh>
      <mesh position={[0, 4.5, 24.5]} receiveShadow>
        <boxGeometry args={[56, 24, 0.6]} />
        <meshStandardMaterial color="#0f172a" roughness={0.85} />
      </mesh>
      <mesh position={[-24.5, 4.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[56, 24, 0.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>
      <mesh position={[24.5, 4.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[56, 24, 0.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>

      {/* 3. NYC Panoramic Sunset Bay Windows on Back Wall */}
      <group position={[0, 5.5, -24.2]}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[22, 11, 0.8]} />
          <meshStandardMaterial color="#18181b" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.1]}>
          <planeGeometry args={[20.8, 9.8]} />
          <meshBasicMaterial color="#0b1329" />
        </mesh>
        {/* Distant Sunset Skyline Silhouette with Glowing Amber Windows */}
        {[-9, -7, -5, -3, -1, 1, 3, 5, 7, 9].map((bx, i) => (
          <group key={`skyline-bld-${i}`} position={[bx * 1.05, -1.2, 0.2]}>
            <mesh position={[0, (i % 4) * 0.9 + 1.4, 0]}>
              <boxGeometry args={[1.3, (i % 4) * 1.8 + 3.6, 0.1]} />
              <meshStandardMaterial color="#1e293b" roughness={0.9} />
            </mesh>
            <mesh position={[0, (i % 4) * 0.9 + 1.4, 0.06]}>
              <planeGeometry args={[1.0, (i % 4) * 1.5 + 3.0]} />
              <meshBasicMaterial color={i % 2 === 0 ? '#f59e0b' : '#fed7aa'} transparent opacity={0.7} />
            </mesh>
          </group>
        ))}
        {[-7.0, -3.5, 0, 3.5, 7.0].map((mx, idx) => (
          <mesh key={`mullion-v-${idx}`} position={[mx, 0, 0.35]}>
            <boxGeometry args={[0.3, 10.2, 0.3]} />
            <meshStandardMaterial color="#27272a" roughness={0.5} />
          </mesh>
        ))}
        {[-2.5, 2.5].map((my, idx) => (
          <mesh key={`mullion-h-${idx}`} position={[0, my, 0.35]}>
            <boxGeometry args={[21.0, 0.3, 0.3]} />
            <meshStandardMaterial color="#27272a" roughness={0.5} />
          </mesh>
        ))}
        <pointLight position={[0, 4, -20]} color="#fed7aa" intensity={15} distance={28} />
      </group>

      {/* 4. Overhead Brass Chandelier */}
      <group position={[0, 15.5, 0]}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[1.2, 1.2, 0.2, 24]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, -3.5, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 7.0, 8]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, -7.0, 0]}>
          <cylinderGeometry args={[0.4, 2.8, 1.4, 24, 1, true]} />
          <meshStandardMaterial color="#09090b" roughness={0.4} metalness={0.8} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -7.0, 0]}>
          <cylinderGeometry args={[0.39, 2.78, 1.38, 24, 1, true]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.95} roughness={0.1} />
        </mesh>
        <mesh position={[0, -6.8, 0]}>
          <sphereGeometry args={[0.4, 16, 16]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <pointLight position={[0, -6.5, 0]} color="#fffbeb" intensity={28} distance={20} castShadow />
      </group>
    </group>
  );
}

// =========================================================================
// SECTION 2: SOLID WOODEN GAMING TABLE & CHAIRS
// =========================================================================
function GamingTableAndChairs({
  showTable = true,
  showChairs = true,
  showSeatMarker = false,
}: {
  showTable?: boolean;
  showChairs?: boolean;
  showSeatMarker?: boolean;
}) {
  return (
    <group position={[0, 0, 0]}>
      {/* Tabletop & Frame with Beveled Edge Trims */}
      {showTable && (
        <group>
          <mesh position={[0, -0.4, 0]} receiveShadow castShadow>
            <boxGeometry args={[27.6, 0.7, 27.6]} />
            <meshStandardMaterial color="#3b1d0e" roughness={0.35} metalness={0.15} />
          </mesh>
          {/* Polished Mahogany Top Surface */}
          <mesh position={[0, -0.05, 0]}>
            <boxGeometry args={[27.9, 0.12, 27.9]} />
            <meshStandardMaterial color="#542a14" roughness={0.25} metalness={0.2} />
          </mesh>
          <mesh position={[0, -0.72, 0]}>
            <boxGeometry args={[26.0, 0.2, 26.0]} />
            <meshStandardMaterial color="#271309" roughness={0.6} />
          </mesh>

          {/* 4 Heavy Wooden Legs */}
          {[
            [-11.5, -11.5],
            [11.5, -11.5],
            [-11.5, 11.5],
            [11.5, 11.5],
          ].map(([tx, tz], i) => (
            <group key={`table-leg-${i}`} position={[tx, -3.9, tz]}>
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.9, 0.7, 6.4, 16]} />
                <meshStandardMaterial color="#3b1d0e" roughness={0.5} />
              </mesh>
              <mesh position={[0, 2.8, 0]}>
                <boxGeometry args={[2.0, 0.8, 2.0]} />
                <meshStandardMaterial color="#271309" roughness={0.6} />
              </mesh>
              <mesh position={[0, -2.9, 0]}>
                <cylinderGeometry args={[1.1, 1.1, 0.6, 16]} />
                <meshStandardMaterial color="#271309" roughness={0.6} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* Chairs */}
      {showChairs && (
        <group>
          {/* CHAIR 1: HUMAN PLAYER'S CHAIR (SOUTH SIDE, Z = 14.6) */}
          <group position={[0, -7.0, 14.6]} rotation={[0, Math.PI, 0]}>
            {[-1.8, 1.8].map((cx, i) =>
              [-1.8, 1.8].map((cz, j) => (
                <mesh key={`pchair-leg-${i}-${j}`} position={[cx, 1.75, cz]} castShadow>
                  <cylinderGeometry args={[0.18, 0.14, 3.5, 8]} />
                  <meshStandardMaterial color="#271309" roughness={0.5} />
                </mesh>
              ))
            )}
            {/* Seat cushion surface sits at world Y = -7.0 + 3.6 + 0.3 = -3.1 */}
            <mesh position={[0, 3.6, 0]} castShadow receiveShadow>
              <boxGeometry args={[4.4, 0.6, 4.4]} />
              <meshStandardMaterial color="#0284c7" roughness={0.7} />
            </mesh>
            <mesh position={[0, 6.6, -1.9]} castShadow>
              <boxGeometry args={[4.2, 5.4, 0.6]} />
              <meshStandardMaterial color="#0369a1" roughness={0.7} />
            </mesh>
            <mesh position={[-2.1, 5.0, 0]} castShadow>
              <boxGeometry args={[0.4, 0.3, 4.0]} />
              <meshStandardMaterial color="#271309" />
            </mesh>
            <mesh position={[2.1, 5.0, 0]} castShadow>
              <boxGeometry args={[0.4, 0.3, 4.0]} />
              <meshStandardMaterial color="#271309" />
            </mesh>
          </group>

          {/* CHAIR 2: TYCOON RIVAL'S CHAIR (NORTH SIDE, Z = -14.6) */}
          <group position={[0, -7.0, -14.6]}>
            {[-1.8, 1.8].map((cx, i) =>
              [-1.8, 1.8].map((cz, j) => (
                <mesh key={`tchair-leg-${i}-${j}`} position={[cx, 1.75, cz]} castShadow>
                  <cylinderGeometry args={[0.18, 0.14, 3.5, 8]} />
                  <meshStandardMaterial color="#18181b" roughness={0.4} />
                </mesh>
              ))
            )}
            <mesh position={[0, 3.6, 0]} castShadow receiveShadow>
              <boxGeometry args={[4.4, 0.6, 4.4]} />
              <meshStandardMaterial color="#881337" roughness={0.7} />
            </mesh>
            <mesh position={[0, 6.6, -1.9]} castShadow>
              <boxGeometry args={[4.2, 5.4, 0.6]} />
              <meshStandardMaterial color="#9f1239" roughness={0.7} />
            </mesh>
            <mesh position={[-2.1, 5.0, 0]} castShadow>
              <boxGeometry args={[0.4, 0.3, 4.0]} />
              <meshStandardMaterial color="#18181b" />
            </mesh>
            <mesh position={[2.1, 5.0, 0]} castShadow>
              <boxGeometry args={[0.4, 0.3, 4.0]} />
              <meshStandardMaterial color="#18181b" />
            </mesh>
          </group>
        </group>
      )}

      {/* Axis & Seat Height Marker for Calibration Mode */}
      {showSeatMarker && (
        <group position={[0, -3.1, 14.6]}>
          <axesHelper args={[2.5]} />
          <mesh>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" wireframe />
          </mesh>
          <CanvasText
            position={[0, 0.4, 0]}
            text="CHAIR SEAT LEVEL (Y = -3.10)"
            fontSize={22}
            color="#38bdf8"
            bgColor="#090d16"
            scale={[0.7, 0.7, 0.7]}
          />
        </group>
      )}
    </group>
  );
}

// =========================================================================
// SECTION 3: SEATED HUMAN PLAYER WITH COMPLETE CALIBRATION SUPPORT
// =========================================================================

let cachedGLTF: { url: string; scene: THREE.Group; animations: THREE.AnimationClip[] } | null = null;
let isLoadingGLTF = false;
const gltfCallbacks: ((res: { data?: any; error?: string }) => void)[] = [];

function resolveModelUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed;
  }
  if (typeof window !== 'undefined' && window.location) {
    try {
      if (window.location.origin && window.location.origin !== 'null') {
        return new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, window.location.origin).href;
      }
      return new URL(trimmed, window.location.href).href;
    } catch {
      return null;
    }
  }
  return null;
}

function useGLTFModel(url: string) {
  const [model, setModel] = useState<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>(
    cachedGLTF && cachedGLTF.url === url ? cachedGLTF : null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedGLTF && cachedGLTF.url === url) {
      setModel(cachedGLTF);
      return;
    }
    if (isLoadingGLTF) {
      gltfCallbacks.push((res) => {
        if (res.error) setError(res.error);
        else if (res.data && res.data.url === url) setModel(res.data);
      });
      return;
    }

    const resolvedUrl = resolveModelUrl(url);
    if (!resolvedUrl) {
      const msg = `[Hustle City 3D Diagnostic] Model URL "${url}" is not reachable. Using stylized avatar.`;
      console.warn(msg);
      setError(msg);
      return;
    }

    isLoadingGLTF = true;
    try {
      const loader = new GLTFLoader();
      loader.load(
        resolvedUrl,
        (gltf) => {
          cachedGLTF = { url, scene: gltf.scene, animations: gltf.animations };
          isLoadingGLTF = false;
          setModel(cachedGLTF);
          gltfCallbacks.forEach((cb) => cb({ data: cachedGLTF }));
          gltfCallbacks.length = 0;
        },
        undefined,
        (err) => {
          isLoadingGLTF = false;
          const msg = `Could not load model at "${url}": ${err?.message || 'Asset not found or unreachable'}`;
          console.warn(`[Hustle City 3D Diagnostic] ${msg}. Using stylized avatar.`);
          setError(msg);
          gltfCallbacks.forEach((cb) => cb({ error: msg }));
          gltfCallbacks.length = 0;
        }
      );
    } catch (e: any) {
      isLoadingGLTF = false;
      const msg = `GLTF loader caught error: ${e?.message || e}`;
      console.warn(`[Hustle City 3D Diagnostic] ${msg}. Using stylized avatar.`);
      setError(msg);
    }
  }, [url]);

  return { model, error };
}

// Inner GLTF Animated Character component for MrTalkofNY_Sitting_Animated_ScaleFixed.glb
function GLTFSeatedPlayerInner({
  gltfData,
  isCurrentTurn,
  isThrowing,
  throwProgress,
  calibration,
  onModelDiagnostic,
}: {
  gltfData: { scene: THREE.Group; animations: THREE.AnimationClip[] };
  isCurrentTurn: boolean;
  isThrowing: boolean;
  throwProgress: number;
  calibration: CharacterCalibration;
  onModelDiagnostic?: (info: {
    status: 'loaded' | 'error';
    animations: string[];
    meshCount: number;
    rawBox: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    materialInfo?: string;
  }) => void;
}) {
  const outerGroupRef = useRef<THREE.Group>(null);
  const { scene, animations } = gltfData;
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    let meshCount = 0;
    let materialCount = 0;
    const matTypes: string[] = [];

    scene.traverse((child: any) => {
      if (child.isMesh || child.isSkinnedMesh) {
        meshCount++;
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat: THREE.Material) => {
            materialCount++;
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
            if ((mat as any).map) {
              (mat as any).map.colorSpace = THREE.SRGBColorSpace;
              (mat as any).map.needsUpdate = true;
            }
            if (!matTypes.includes(mat.type)) {
              matTypes.push(mat.type);
            }
          });
        }
      }
    });

    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;

    const animNames = animations ? animations.map((a) => a.name) : [];

    // Update matrices and compute world bounding box
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    if (onModelDiagnostic) {
      onModelDiagnostic({
        status: 'loaded',
        animations: animNames,
        meshCount,
        rawBox: { x: size.x, y: size.y, z: size.z },
        center: { x: center.x, y: center.y, z: center.z },
        materialInfo: `${materialCount} materials (${matTypes.join(', ') || 'Standard'})`,
      });
    }

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    };
  }, [scene, animations, onModelDiagnostic]);

  // Handle Animation Playback or Reset via Calibration Controls
  useEffect(() => {
    if (!mixerRef.current) return;
    const mixer = mixerRef.current;

    if (!calibration.isPlayingAnimation) {
      mixer.stopAllAction();
      currentActionRef.current = null;
      return;
    }

    if (animations && animations.length > 0) {
      const selectedClip =
        animations.find((a) => a.name === calibration.selectedAnimation) ||
        animations.find((a) => /^sitting/i.test(a.name)) ||
        animations.find((a) => /sit/i.test(a.name)) ||
        animations.find((a) => /chair/i.test(a.name)) ||
        animations.find((a) => /idle/i.test(a.name)) ||
        animations[0];

      if (selectedClip) {
        mixer.stopAllAction();
        const action = mixer.clipAction(selectedClip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        currentActionRef.current = action;
      }
    }
  }, [calibration.selectedAnimation, calibration.isPlayingAnimation, animations]);

  useFrame((_, delta) => {
    if (mixerRef.current && calibration.isPlayingAnimation) {
      mixerRef.current.update(delta);
    }

    if (outerGroupRef.current) {
      // Subtle seated upper-body lean toward the board during dice throw if not in calibration
      if (isThrowing) {
        if (throwProgress < 0.4) {
          const p = throwProgress / 0.4;
          outerGroupRef.current.rotation.x = calibration.rotX - THREE.MathUtils.lerp(0, 0.12, p);
          outerGroupRef.current.position.z = THREE.MathUtils.lerp(calibration.posZ, calibration.posZ - 0.3, p);
        } else {
          const p = (throwProgress - 0.4) / 0.6;
          outerGroupRef.current.rotation.x = calibration.rotX - THREE.MathUtils.lerp(0.12, 0, p);
          outerGroupRef.current.position.z = THREE.MathUtils.lerp(calibration.posZ - 0.3, calibration.posZ, p);
        }
      } else {
        outerGroupRef.current.rotation.x = THREE.MathUtils.lerp(outerGroupRef.current.rotation.x, calibration.rotX, delta * 5);
        outerGroupRef.current.position.z = THREE.MathUtils.lerp(outerGroupRef.current.position.z, calibration.posZ, delta * 5);
      }
    }
  });

  return (
    // Stable external parent group outside the animated skeleton
    <group
      ref={outerGroupRef}
      position={[calibration.posX, calibration.posY, calibration.posZ]}
      rotation={[calibration.rotX, calibration.rotY, calibration.rotZ]}
      scale={[calibration.scale, calibration.scale, calibration.scale]}
    >
      <primitive object={scene} />

      {/* Visual Bounding Box Helper */}
      {calibration.showBoundingBox && (
        <mesh position={[0, 0.8, 0]}>
          <boxGeometry args={[1.2, 1.8, 1.2]} />
          <meshBasicMaterial color="#22c55e" wireframe />
        </mesh>
      )}

      {/* Axis helper at character root */}
      {calibration.showAxisHelper && <axesHelper args={[1.5]} />}
    </group>
  );
}

// Stylized procedural fallback avatar
function ProceduralSeatedPlayer({
  isCurrentTurn,
  isThrowing,
  throwProgress,
  calibration,
}: {
  isCurrentTurn: boolean;
  isThrowing: boolean;
  throwProgress: number;
  calibration: CharacterCalibration;
}) {
  const rightArmRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();

    if (headRef.current) {
      if (isCurrentTurn) {
        headRef.current.rotation.y = Math.sin(t * 1.5) * 0.1;
        headRef.current.rotation.x = -0.15 + Math.sin(t * 2) * 0.04;
      } else {
        headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, 0, delta * 3);
        headRef.current.rotation.x = -0.1;
      }
    }

    if (rightArmRef.current) {
      if (isThrowing) {
        if (throwProgress < 0.35) {
          const p = throwProgress / 0.35;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(0.2, 0.8, p);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(0, -0.3, p);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(0, -0.2, p);
        } else if (throwProgress < 0.75) {
          const p = (throwProgress - 0.35) / 0.4;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(0.8, -0.6, p);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(-0.3, 0.2, p);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(-0.2, -0.4, p);
        } else {
          const p = (throwProgress - 0.75) / 0.25;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(-0.6, 0.9, p);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(0.2, -0.1, p);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(-0.4, 0, p);
        }
      } else {
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.x,
          0.3 + Math.sin(t * 1.8) * 0.03,
          delta * 6
        );
        rightArmRef.current.rotation.y = THREE.MathUtils.lerp(rightArmRef.current.rotation.y, -0.1, delta * 6);
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, 0, delta * 6);
      }
    }
  });

  return (
    <group
      position={[calibration.posX, calibration.posY, calibration.posZ]}
      rotation={[calibration.rotX, calibration.rotY, calibration.rotZ]}
      scale={[calibration.scale * 0.42, calibration.scale * 0.42, calibration.scale * 0.42]}
    >
      {/* Lower Legs & Boots */}
      <group position={[-0.45, 0, 0.2]}>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.26, 0.28, 1.6, 12]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.7} />
        </mesh>
        <group position={[0, 0.28, 0.2]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.55, 0.95]} />
            <meshStandardMaterial color="#c29b38" roughness={0.65} />
          </mesh>
          <mesh position={[0, -0.25, 0]}>
            <boxGeometry args={[0.54, 0.12, 1.0]} />
            <meshStandardMaterial color="#451a03" roughness={0.9} />
          </mesh>
        </group>
      </group>

      <group position={[0.45, 0, 0.2]}>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.26, 0.28, 1.6, 12]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.7} />
        </mesh>
        <group position={[0, 0.28, 0.2]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.55, 0.95]} />
            <meshStandardMaterial color="#c29b38" roughness={0.65} />
          </mesh>
          <mesh position={[0, -0.25, 0]}>
            <boxGeometry args={[0.54, 0.12, 1.0]} />
            <meshStandardMaterial color="#451a03" roughness={0.9} />
          </mesh>
        </group>
      </group>

      {/* Thighs */}
      <mesh position={[-0.45, 1.65, 0.65]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 1.5, 12]} />
        <meshStandardMaterial color="#1e3a8a" roughness={0.7} />
      </mesh>
      <mesh position={[0.45, 1.65, 0.65]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 1.5, 12]} />
        <meshStandardMaterial color="#1e3a8a" roughness={0.7} />
      </mesh>

      {/* Torso & Gold Medallion */}
      <group position={[0, 2.8, 1.25]}>
        <mesh castShadow>
          <boxGeometry args={[1.65, 1.7, 1.1]} />
          <meshStandardMaterial color="#64748b" roughness={0.85} />
        </mesh>
        <mesh position={[0, -0.3, -0.58]} castShadow>
          <boxGeometry args={[1.0, 0.55, 0.16]} />
          <meshStandardMaterial color="#475569" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.65, 0.45]} rotation={[-0.3, 0, 0]} castShadow>
          <boxGeometry args={[1.2, 0.7, 0.4]} />
          <meshStandardMaterial color="#475569" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.4, -0.58]}>
          <torusGeometry args={[0.42, 0.06, 8, 24]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.95} roughness={0.1} />
        </mesh>
        <group position={[0, 0.05, -0.62]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.24, 0.24, 0.06, 24]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.95} roughness={0.1} />
          </mesh>
          <mesh position={[0, 0, -0.04]}>
            <boxGeometry args={[0.16, 0.16, 0.02]} rotation={[0, 0, Math.PI / 4]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      </group>

      {/* Left Arm */}
      <group position={[-0.95, 3.2, 1.2]}>
        <mesh position={[0, -0.6, -0.3]} rotation={[0.4, 0, 0.2]} castShadow>
          <cylinderGeometry args={[0.22, 0.2, 1.3, 12]} />
          <meshStandardMaterial color="#64748b" />
        </mesh>
        <mesh position={[0.05, -1.2, -0.7]} castShadow>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshStandardMaterial color="#78431e" roughness={0.6} />
        </mesh>
      </group>

      {/* Right Throwing Arm */}
      <group ref={rightArmRef} position={[0.95, 3.3, 1.1]}>
        <mesh position={[0, -0.6, -0.3]} rotation={[0.4, 0, -0.2]} castShadow>
          <cylinderGeometry args={[0.22, 0.2, 1.3, 12]} />
          <meshStandardMaterial color="#64748b" />
        </mesh>
        <group position={[-0.05, -1.2, -0.7]}>
          <mesh castShadow>
            <sphereGeometry args={[0.2, 12, 12]} />
            <meshStandardMaterial color="#78431e" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.1, 12]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>
      </group>

      {/* Head, Cap & Glasses */}
      <group ref={headRef} position={[0, 4.15, 1.25]}>
        <mesh castShadow>
          <sphereGeometry args={[0.62, 24, 24]} />
          <meshStandardMaterial color="#78431e" roughness={0.55} />
        </mesh>
        <mesh position={[0, -0.22, -0.4]}>
          <boxGeometry args={[0.55, 0.38, 0.45]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        <group position={[0, 0.08, -0.58]}>
          <mesh>
            <boxGeometry args={[0.96, 0.08, 0.08]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.95} />
          </mesh>
          <mesh position={[-0.24, -0.08, -0.04]}>
            <boxGeometry args={[0.36, 0.26, 0.05]} />
            <meshStandardMaterial color="#090d16" roughness={0.1} metalness={0.9} />
          </mesh>
          <mesh position={[0.24, -0.08, -0.04]}>
            <boxGeometry args={[0.36, 0.26, 0.05]} />
            <meshStandardMaterial color="#090d16" roughness={0.1} metalness={0.9} />
          </mesh>
        </group>
        <group position={[0, 0.38, 0.05]}>
          <mesh castShadow>
            <sphereGeometry args={[0.64, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
            <meshStandardMaterial color="#0a1128" roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.08, -0.72]} rotation={[-0.2, 0, 0]} castShadow>
            <boxGeometry args={[0.85, 0.08, 0.65]} />
            <meshStandardMaterial color="#0a1128" roughness={0.75} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// Master Seated Player wrapper that integrates MrTalkofNY_Sitting_Animated_ScaleFixed.glb with calibration
function LifeSizeSeatedPlayer({
  isCurrentTurn,
  isThrowing,
  throwProgress,
  calibration,
  onModelDiagnostic,
}: {
  isCurrentTurn: boolean;
  isThrowing: boolean;
  throwProgress: number;
  calibration: CharacterCalibration;
  onModelDiagnostic?: (info: {
    status: 'loaded' | 'error';
    animations: string[];
    meshCount: number;
    rawBox: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    materialInfo?: string;
  }) => void;
}) {
  const modelUrl =
    getConfig('characterModelUrl') ||
    'https://judahgamesinc.github.io/hustlecity-assets/MrTalkofNY_Sitting_Animated_ScaleFixed.glb';
  const { model, error } = useGLTFModel(modelUrl);

  useEffect(() => {
    if (error && onModelDiagnostic) {
      onModelDiagnostic({
        status: 'error',
        animations: [],
        meshCount: 0,
        rawBox: { x: 0, y: 0, z: 0 },
        center: { x: 0, y: 0, z: 0 },
        materialInfo: 'Failed to load model',
      });
    }
  }, [error, onModelDiagnostic]);

  if (model) {
    return (
      <GLTFSeatedPlayerInner
        gltfData={model}
        isCurrentTurn={isCurrentTurn}
        isThrowing={isThrowing}
        throwProgress={throwProgress}
        calibration={calibration}
        onModelDiagnostic={onModelDiagnostic}
      />
    );
  }

  return (
    <ProceduralSeatedPlayer
      isCurrentTurn={isCurrentTurn}
      isThrowing={isThrowing}
      throwProgress={throwProgress}
      calibration={calibration}
    />
  );
}

// =========================================================================
// SECTION 4: LIFE-SIZE SEATED COMPUTER TYCOON
// =========================================================================
function LifeSizeSeatedTycoon({
  isCurrentTurn,
  isThrowing,
  throwProgress,
}: {
  isCurrentTurn: boolean;
  isThrowing: boolean;
  throwProgress: number;
}) {
  const rightArmRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();

    if (headRef.current) {
      if (isCurrentTurn) {
        headRef.current.rotation.y = Math.sin(t * 1.5) * 0.12;
        headRef.current.rotation.x = -0.1 + Math.sin(t * 2) * 0.03;
      } else {
        headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, 0, delta * 3);
        headRef.current.rotation.x = -0.1;
      }
    }

    if (rightArmRef.current) {
      if (isThrowing) {
        if (throwProgress < 0.35) {
          const p = throwProgress / 0.35;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(0.2, 0.8, p);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(0, 0.3, p);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(0, 0.2, p);
        } else if (throwProgress < 0.75) {
          const p = (throwProgress - 0.35) / 0.4;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(0.8, -0.65, p);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(0.3, -0.2, p);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(0.2, 0.4, p);
        } else {
          const p = (throwProgress - 0.75) / 0.25;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(-0.65, 0.9, p);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(-0.2, 0.1, p);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(0.4, 0, p);
        }
      } else {
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.x,
          0.3 + Math.sin(t * 1.8) * 0.03,
          delta * 6
        );
        rightArmRef.current.rotation.y = THREE.MathUtils.lerp(rightArmRef.current.rotation.y, 0.1, delta * 6);
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, 0, delta * 6);
      }
    }
  });

  return (
    <group position={[0, -7.0, -13.8]} scale={[2.6, 2.6, 2.6]}>
      {/* Lower Legs & Shoes */}
      <group position={[-0.45, 0, -0.2]}>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.26, 1.6, 12]} />
          <meshStandardMaterial color="#18181b" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.24, -0.2]} castShadow>
          <boxGeometry args={[0.46, 0.48, 0.9]} />
          <meshStandardMaterial color="#09090b" roughness={0.2} metalness={0.5} />
        </mesh>
      </group>

      <group position={[0.45, 0, -0.2]}>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.26, 1.6, 12]} />
          <meshStandardMaterial color="#18181b" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.24, -0.2]} castShadow>
          <boxGeometry args={[0.46, 0.48, 0.9]} />
          <meshStandardMaterial color="#09090b" roughness={0.2} metalness={0.5} />
        </mesh>
      </group>

      {/* Thighs */}
      <mesh position={[-0.45, 1.65, -0.65]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 1.5, 12]} />
        <meshStandardMaterial color="#18181b" roughness={0.4} />
      </mesh>
      <mesh position={[0.45, 1.65, -0.65]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 1.5, 12]} />
        <meshStandardMaterial color="#18181b" roughness={0.4} />
      </mesh>

      {/* Tuxedo */}
      <group position={[0, 2.8, -1.25]}>
        <mesh castShadow>
          <boxGeometry args={[1.55, 1.7, 1.0]} />
          <meshStandardMaterial color="#09090b" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.2, 0.52]}>
          <boxGeometry args={[0.55, 1.2, 0.05]} />
          <meshStandardMaterial color="#ffffff" roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.65, 0.56]}>
          <boxGeometry args={[0.5, 0.2, 0.12]} />
          <meshStandardMaterial color="#dc2626" roughness={0.4} />
        </mesh>
      </group>

      {/* Left Arm with Cane */}
      <group position={[-0.95, 3.2, -1.2]}>
        <mesh position={[0, -0.6, 0.3]} rotation={[-0.4, 0, 0.2]} castShadow>
          <cylinderGeometry args={[0.2, 0.18, 1.3, 12]} />
          <meshStandardMaterial color="#09090b" />
        </mesh>
        <mesh position={[0.05, -1.2, 0.7]} castShadow>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.3} />
        </mesh>
        <group position={[0.05, -0.8, 0.7]} rotation={[-0.2, 0, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.05, 0.05, 2.8, 8]} />
            <meshStandardMaterial color="#18181b" roughness={0.3} />
          </mesh>
          <mesh position={[0, 1.45, 0]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>
      </group>

      {/* Right Arm */}
      <group ref={rightArmRef} position={[0.95, 3.3, -1.1]}>
        <mesh position={[0, -0.6, 0.3]} rotation={[-0.4, 0, -0.2]} castShadow>
          <cylinderGeometry args={[0.2, 0.18, 1.3, 12]} />
          <meshStandardMaterial color="#09090b" />
        </mesh>
        <group position={[-0.05, -1.2, 0.7]}>
          <mesh castShadow>
            <sphereGeometry args={[0.2, 12, 12]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
        </group>
      </group>

      {/* Head & Top Hat */}
      <group ref={headRef} position={[0, 4.15, -1.25]}>
        <mesh castShadow>
          <sphereGeometry args={[0.62, 24, 24]} />
          <meshStandardMaterial color="#fef08a" roughness={0.45} />
        </mesh>
        <group position={[0, -0.18, 0.58]}>
          <mesh position={[-0.22, 0, 0]} rotation={[0, 0, -0.35]}>
            <capsuleGeometry args={[0.08, 0.36, 4, 8]} />
            <meshStandardMaterial color="#111827" roughness={0.3} />
          </mesh>
          <mesh position={[0.22, 0, 0]} rotation={[0, 0, 0.35]}>
            <capsuleGeometry args={[0.08, 0.36, 4, 8]} />
            <meshStandardMaterial color="#111827" roughness={0.3} />
          </mesh>
        </group>
        <group position={[0.26, 0.12, 0.56]}>
          <mesh>
            <ringGeometry args={[0.12, 0.16, 20]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.95} />
          </mesh>
        </group>
        <group position={[0, 0.58, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.95, 0.95, 0.1, 24]} />
            <meshStandardMaterial color="#09090b" roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.8, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.66, 1.5, 24]} />
            <meshStandardMaterial color="#09090b" roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.67, 0.67, 0.22, 24]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// =========================================================================
// SECTION 5: OUTER PERIMETER ROADWAY & DETERMINISTIC VEHICLE TRAFFIC
// =========================================================================

function OuterPerimeterRoadAndTraffic() {
  const roadCurve = useMemo(() => {
    const points = [
      new THREE.Vector3(-9.8, 0.05, 11.6), // South road
      new THREE.Vector3(9.8, 0.05, 11.6),
      new THREE.Vector3(11.6, 0.05, 9.8), // East road
      new THREE.Vector3(11.6, 0.05, -9.8),
      new THREE.Vector3(9.8, 0.05, -11.6), // North road
      new THREE.Vector3(-9.8, 0.05, -11.6),
      new THREE.Vector3(-11.6, 0.05, -9.8), // West road
      new THREE.Vector3(-11.6, 0.05, 9.8),
    ];
    return new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.2);
  }, []);

  const vehicles = useMemo(
    () => [
      { id: 1, type: 'TAXI', color: '#facc15', roofColor: '#ffffff', speed: 4.8, offset: 0.02 },
      { id: 2, type: 'SEDAN', color: '#ef4444', roofColor: '#ef4444', speed: 4.6, offset: 0.16 },
      { id: 3, type: 'SUV', color: '#090d16', roofColor: '#090d16', speed: 4.5, offset: 0.31 },
      { id: 4, type: 'TAXI', color: '#eab308', roofColor: '#ffffff', speed: 4.8, offset: 0.46 },
      { id: 5, type: 'COUPE', color: '#3b82f6', roofColor: '#1e3a8a', speed: 4.7, offset: 0.61 },
      { id: 6, type: 'VAN', color: '#10b981', roofColor: '#ffffff', speed: 4.4, offset: 0.76 },
      { id: 7, type: 'SEDAN', color: '#f97316', roofColor: '#f97316', speed: 4.6, offset: 0.89 },
    ],
    []
  );

  const vehicleRefs = useRef<(THREE.Group | null)[]>([]);
  const progressRefs = useRef<number[]>(vehicles.map((v) => v.offset));

  const scratchPos = useMemo(() => new THREE.Vector3(), []);
  const scratchTangent = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    vehicles.forEach((v, idx) => {
      const mesh = vehicleRefs.current[idx];
      if (!mesh) return;

      const totalLen = 88.0;
      progressRefs.current[idx] = (progressRefs.current[idx] + (v.speed * delta) / totalLen) % 1.0;
      const t = progressRefs.current[idx];

      roadCurve.getPointAt(t, scratchPos);
      roadCurve.getTangentAt(t, scratchTangent);

      mesh.position.set(scratchPos.x, 0.05, scratchPos.z);
      const heading = Math.atan2(scratchTangent.x, scratchTangent.z);
      mesh.rotation.set(0, heading, 0);
    });
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Perimeter Asphalt Roadbed with Dark Weathered Texture */}
      <mesh position={[0, 0.02, 11.6]} receiveShadow>
        <boxGeometry args={[25.6, 0.04, 1.8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.02, -11.6]} receiveShadow>
        <boxGeometry args={[25.6, 0.04, 1.8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>
      <mesh position={[11.6, 0.02, 0]} receiveShadow>
        <boxGeometry args={[1.8, 0.04, 25.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>
      <mesh position={[-11.6, 0.02, 0]} receiveShadow>
        <boxGeometry args={[1.8, 0.04, 25.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} />
      </mesh>

      {/* Granite Curbs and Sidewalks */}
      {[-12.65, 12.65].map((sx, i) => (
        <mesh key={`curb-x-${i}`} position={[sx, 0.04, 0]} receiveShadow>
          <boxGeometry args={[0.3, 0.08, 27.2]} />
          <meshStandardMaterial color="#64748b" roughness={0.85} />
        </mesh>
      ))}
      {[-12.65, 12.65].map((sz, i) => (
        <mesh key={`curb-z-${i}`} position={[0, 0.04, sz]} receiveShadow>
          <boxGeometry args={[27.2, 0.08, 0.3]} />
          <meshStandardMaterial color="#64748b" roughness={0.85} />
        </mesh>
      ))}

      {/* Yellow dashed centerlines */}
      {[-8, -5, -2, 1, 4, 7].map((cx, i) => (
        <React.Fragment key={`yellow-dash-ns-${i}`}>
          <mesh position={[cx, 0.042, 11.6]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, 0.08]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
          <mesh position={[cx, 0.042, -11.6]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, 0.08]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
        </React.Fragment>
      ))}
      {[-8, -5, -2, 1, 4, 7].map((cz, i) => (
        <React.Fragment key={`yellow-dash-ew-${i}`}>
          <mesh position={[11.6, 0.042, cz]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
            <planeGeometry args={[1.6, 0.08]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
          <mesh position={[-11.6, 0.042, cz]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
            <planeGeometry args={[1.6, 0.08]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
        </React.Fragment>
      ))}

      {/* Crosswalk Zebra Markings */}
      {[
        [-9.8, 11.6],
        [9.8, 11.6],
        [-9.8, -11.6],
        [9.8, -11.6],
      ].map(([px, pz], i) => (
        <group key={`crosswalk-${i}`} position={[px, 0.042, pz]}>
          {[-0.6, -0.2, 0.2, 0.6].map((st, j) => (
            <mesh key={`cw-stripe-${j}`} position={[0, 0, st]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.9, 0.22]} />
              <meshBasicMaterial color="#f8fafc" />
            </mesh>
          ))}
        </group>
      ))}

      {/* Streetlamps & Street Signs with Cast Light */}
      {[
        [-12.2, 8.0, 'W 125TH ST'],
        [-12.2, -8.0, 'LENOX AVE'],
        [12.2, 8.0, 'MALCOLM X BLVD'],
        [12.2, -8.0, '7TH AVE'],
      ].map(([lx, lz, signText], i) => (
        <group key={`streetlight-${i}`} position={[Number(lx), 0.08, Number(lz)]}>
          <mesh position={[0, 1.0, 0]} castShadow>
            <cylinderGeometry args={[0.045, 0.07, 2.0, 8]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.7} />
          </mesh>
          <mesh position={[0, 2.05, 0]}>
            <sphereGeometry args={[0.18, 12, 12]} />
            <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} />
          </mesh>
          <pointLight position={[0, 2.0, 0]} color="#fef08a" intensity={3.5} distance={5.0} />
          <CanvasText
            position={[0, 1.5, 0.1]}
            text={String(signText)}
            fontSize={20}
            color="#ffffff"
            bgColor="#065f46"
            scale={[0.45, 0.45, 0.45]}
          />
        </group>
      ))}

      {/* Miniature NYC Fire Hydrants */}
      {[
        [-12.2, 4.0],
        [12.2, -4.0],
      ].map(([hx, hz], idx) => (
        <group key={`hydrant-${idx}`} position={[hx, 0.06, hz]}>
          <mesh position={[0, 0.2, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.11, 0.38, 10]} />
            <meshStandardMaterial color="#dc2626" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.41, 0]} castShadow>
            <sphereGeometry args={[0.1, 10, 10]} />
            <meshStandardMaterial color="#dc2626" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.24, 0.1]}>
            <cylinderGeometry args={[0.04, 0.04, 0.12, 8]} rotation={[Math.PI / 2, 0, 0]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Animated Vehicles */}
      {vehicles.map((v, i) => (
        <group
          key={`car-${v.id}`}
          ref={(el) => {
            vehicleRefs.current[i] = el;
          }}
          scale={[0.42, 0.42, 0.42]}
        >
          <mesh position={[0, 0.24, 0]} castShadow>
            <boxGeometry args={[1.0, 0.32, 2.0]} />
            <meshStandardMaterial color={v.color} roughness={0.3} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.5, -0.1]} castShadow>
            <boxGeometry args={[0.82, 0.28, 1.1]} />
            <meshStandardMaterial color="#0f172a" roughness={0.15} metalness={0.9} />
          </mesh>
          <mesh position={[0, 0.65, -0.1]}>
            <boxGeometry args={[0.84, 0.04, 1.12]} />
            <meshStandardMaterial color={v.roofColor} roughness={0.4} />
          </mesh>

          {v.type === 'TAXI' && (
            <group position={[0, 0.74, -0.1]}>
              <mesh castShadow>
                <boxGeometry args={[0.45, 0.14, 0.25]} />
                <meshStandardMaterial color="#ffffff" roughness={0.2} />
              </mesh>
              <mesh position={[0, 0, 0.13]}>
                <planeGeometry args={[0.42, 0.1]} />
                <meshBasicMaterial color="#facc15" />
              </mesh>
            </group>
          )}

          <mesh position={[-0.34, 0.22, 1.01]}>
            <boxGeometry args={[0.2, 0.1, 0.04]} />
            <meshBasicMaterial color="#fef08a" />
          </mesh>
          <mesh position={[0.34, 0.22, 1.01]}>
            <boxGeometry args={[0.2, 0.1, 0.04]} />
            <meshBasicMaterial color="#fef08a" />
          </mesh>
          <mesh position={[-0.34, 0.22, -1.01]}>
            <boxGeometry args={[0.2, 0.1, 0.04]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <mesh position={[0.34, 0.22, -1.01]}>
            <boxGeometry args={[0.2, 0.1, 0.04]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>

          {[-0.52, 0.52].map((wx, xi) =>
            [-0.6, 0.6].map((wz, zi) => (
              <mesh
                key={`wh-${xi}-${zi}`}
                position={[wx, 0.15, wz]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
              >
                <cylinderGeometry args={[0.18, 0.18, 0.14, 12]} />
                <meshStandardMaterial color="#09090b" roughness={0.8} />
              </mesh>
            ))
          )}
        </group>
      ))}
    </group>
  );
}

// =========================================================================
// SECTION 6: PREMIUM HARLEM & NYC ARCHITECTURE DIORAMA (REFERENCE MATCH)
// =========================================================================

function MiniatureTree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 0.9, 8]} />
        <meshStandardMaterial color="#451a03" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.0, 0]} castShadow>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshStandardMaterial color="#15803d" roughness={0.75} />
      </mesh>
      <mesh position={[0, 1.45, 0]} castShadow>
        <sphereGeometry args={[0.38, 12, 12]} />
        <meshStandardMaterial color="#16a34a" roughness={0.75} />
      </mesh>
      <mesh position={[0, 1.8, 0]} castShadow>
        <sphereGeometry args={[0.26, 10, 10]} />
        <meshStandardMaterial color="#4ade80" roughness={0.7} />
      </mesh>
    </group>
  );
}

// 1. Weathered Corner Brownstone & Bodega (Inspired by reference corner building)
// Features: Weathered tan/brown brick, corner bay window, glowing store display window, awning, roof chimney & water tank
function NYCCornerBrownstoneAndBodega({ position }: { position: [number, number, number] }) {
  const tanBrickTexture = useMemo(
    () => createWeatheredBrickCanvasTexture('#8c7355', '#a38a6d', '#3e3428', '#6b5842', 24, 12),
    []
  );

  return (
    <group position={position}>
      {/* Main Weathered Tan/Brown Masonry Building Body */}
      <mesh position={[0, 2.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 5.0, 3.2]} />
        <meshStandardMaterial
          color="#8c7355"
          map={tanBrickTexture || undefined}
          roughness={0.82}
        />
      </mesh>

      {/* Decorative Dental Cornice with Carved Corbels */}
      <mesh position={[0, 5.15, 0]} castShadow>
        <boxGeometry args={[3.85, 0.35, 3.45]} />
        <meshStandardMaterial color="#45382c" roughness={0.65} />
      </mesh>
      <mesh position={[0, 5.4, 0]} castShadow>
        <boxGeometry args={[3.7, 0.2, 3.3]} />
        <meshStandardMaterial color="#30271f" roughness={0.7} />
      </mesh>

      {/* Rooftop Moss & Gravel Inlay */}
      <mesh position={[0, 5.02, 0]}>
        <boxGeometry args={[3.4, 0.05, 3.0]} />
        <meshStandardMaterial color="#2d3748" roughness={0.95} />
      </mesh>

      {/* Ground Floor Corner Bodega with Angled Awning & Glowing Display Window */}
      <group position={[0, 0.7, 1.62]}>
        {/* Bodega Shopfront Frame */}
        <mesh castShadow>
          <boxGeometry args={[3.4, 1.35, 0.08]} />
          <meshStandardMaterial color="#1c1917" roughness={0.5} />
        </mesh>
        {/* Large Glowing Display Window with Warm Interior Store Lamps */}
        <mesh position={[-0.6, 0.05, 0.05]}>
          <planeGeometry args={[1.8, 0.95]} />
          <meshBasicMaterial color="#fed7aa" />
        </mesh>
        {/* Shop Entrance Door */}
        <mesh position={[1.0, -0.05, 0.05]}>
          <boxGeometry args={[0.7, 1.15, 0.04]} />
          <meshStandardMaterial color="#292524" roughness={0.4} />
        </mesh>
        {/* Striped Bodega Fabric Awning with Metal Brackets */}
        <mesh position={[-0.6, 0.65, 0.35]} rotation={[0.45, 0, 0]} castShadow>
          <boxGeometry args={[2.0, 0.65, 0.08]} />
          <meshStandardMaterial color="#065f46" roughness={0.75} />
        </mesh>
        <pointLight position={[-0.6, 0.1, 0.4]} color="#fef08a" intensity={4.5} distance={4.5} />
      </group>

      <CanvasText
        position={[-0.6, 1.68, 1.68]}
        text="125th ST DELI & GROCERY"
        fontSize={20}
        color="#ffffff"
        bgColor="#065f46"
        scale={[0.55, 0.55, 0.55]}
      />

      {/* 2nd Floor Projecting Corner Bay Window (Key Reference Architecture Detail) */}
      <group position={[-0.8, 2.7, 1.75]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.3, 1.2, 0.45]} />
          <meshStandardMaterial color="#45382c" roughness={0.65} />
        </mesh>
        {[-0.4, 0, 0.4].map((wx, i) => (
          <mesh key={`bay-win-${i}`} position={[wx, 0, 0.24]}>
            <planeGeometry args={[0.3, 0.85]} />
            <meshBasicMaterial color="#fef08a" />
          </mesh>
        ))}
        {/* Bay Window Rooflet */}
        <mesh position={[0, 0.65, 0]} rotation={[0.3, 0, 0]} castShadow>
          <boxGeometry args={[1.4, 0.12, 0.52]} />
          <meshStandardMaterial color="#1e293b" roughness={0.5} />
        </mesh>
      </group>

      {/* 2nd & 3rd Floor Recessed Windows with Sandstone Headers & Sills */}
      {[0.8].map((wx, i) =>
        [2.7, 4.1].map((wy, j) => (
          <React.Fragment key={`cb-win-right-${i}-${j}`}>
            {/* Window Sill */}
            <mesh position={[wx, wy - 0.5, 1.62]}>
              <boxGeometry args={[0.75, 0.1, 0.12]} />
              <meshStandardMaterial color="#d6d3d1" roughness={0.6} />
            </mesh>
            {/* Glowing Glass */}
            <mesh position={[wx, wy, 1.61]}>
              <planeGeometry args={[0.6, 0.85]} />
              <meshBasicMaterial color={j === 0 ? '#fef08a' : '#fed7aa'} />
            </mesh>
            {/* Carved Stone Lintel / Header */}
            <mesh position={[wx, wy + 0.5, 1.62]}>
              <boxGeometry args={[0.78, 0.14, 0.1]} />
              <meshStandardMaterial color="#d6d3d1" roughness={0.6} />
            </mesh>
          </React.Fragment>
        ))
      )}

      {/* 3rd Floor Windows across full width */}
      {[-0.8, 0].map((wx, i) => (
        <React.Fragment key={`cb-win-top-${i}`}>
          <mesh position={[wx, 4.1, 1.61]}>
            <planeGeometry args={[0.6, 0.85]} />
            <meshBasicMaterial color="#fed7aa" />
          </mesh>
          <mesh position={[wx, 4.6, 1.62]}>
            <boxGeometry args={[0.75, 0.12, 0.1]} />
            <meshStandardMaterial color="#d6d3d1" roughness={0.6} />
          </mesh>
        </React.Fragment>
      ))}

      {/* 3D Black Wrought-Iron Fire Escape on Side Facade */}
      <group position={[1.82, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        {[2.5, 3.9].map((fy, idx) => (
          <group key={`side-fe-${idx}`} position={[0, fy, 0.35]}>
            <mesh castShadow>
              <boxGeometry args={[1.4, 0.05, 0.55]} />
              <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
            </mesh>
            <mesh position={[0, 0.22, 0.26]}>
              <boxGeometry args={[1.4, 0.42, 0.04]} />
              <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
            </mesh>
            <mesh position={[-0.68, 0.22, 0]}>
              <boxGeometry args={[0.04, 0.42, 0.52]} />
              <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
            </mesh>
            <mesh position={[0.68, 0.22, 0]}>
              <boxGeometry args={[0.04, 0.42, 0.52]} />
              <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
            </mesh>
          </group>
        ))}
        {/* Connecting Fire Escape Ladder */}
        <mesh position={[0.2, 3.2, 0.45]} rotation={[0.4, 0, 0]} castShadow>
          <boxGeometry args={[0.28, 1.6, 0.04]} />
          <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
        </mesh>
      </group>

      {/* Rooftop Brick Chimney with Terracotta Flue Liners */}
      <group position={[-1.1, 5.7, -0.7]}>
        <mesh castShadow>
          <boxGeometry args={[0.65, 0.95, 0.65]} />
          <meshStandardMaterial color="#7c2d12" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[0.16, 0.18, 0.35, 8]} />
          <meshStandardMaterial color="#ea580c" roughness={0.9} />
        </mesh>
      </group>

      {/* Rooftop Wooden Water Tower */}
      <group position={[0.7, 6.2, 0.2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.55, 0.55, 0.95, 16]} />
          <meshStandardMaterial color="#78350f" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.65, 0]} castShadow>
          <coneGeometry args={[0.6, 0.45, 16]} />
          <meshStandardMaterial color="#451a03" roughness={0.8} />
        </mesh>
        {/* Steel Bands on Wooden Tank */}
        {[-0.2, 0.2].map((by, bi) => (
          <mesh key={`wt-band-${bi}`} position={[0, by, 0]}>
            <cylinderGeometry args={[0.56, 0.56, 0.04, 16]} />
            <meshStandardMaterial color="#09090b" metalness={0.9} />
          </mesh>
        ))}
        {[-0.35, 0.35].map((tx, ti) =>
          [-0.35, 0.35].map((tz, tj) => (
            <mesh key={`wt-leg-${ti}-${tj}`} position={[tx, -0.7, tz]} castShadow>
              <cylinderGeometry args={[0.035, 0.035, 0.55, 6]} />
              <meshStandardMaterial color="#18181b" metalness={0.8} />
            </mesh>
          ))
        )}
      </group>
    </group>
  );
}

// 2. Weathered Sage Green Brownstone (Inspired by the left green building in reference image)
function NYCSageGreenBrownstone({ position }: { position: [number, number, number] }) {
  const greenBrickTexture = useMemo(
    () => createWeatheredBrickCanvasTexture('#2d5a52', '#3a6f66', '#1b3833', '#1e4039', 24, 12),
    []
  );

  return (
    <group position={position}>
      {/* Main Painted Green Brick Body */}
      <mesh position={[0, 2.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 4.8, 3.0]} />
        <meshStandardMaterial
          color="#2d5a52"
          map={greenBrickTexture || undefined}
          roughness={0.8}
        />
      </mesh>

      {/* Ornate Dental Roof Cornice */}
      <mesh position={[0, 4.95, 0]} castShadow>
        <boxGeometry args={[3.65, 0.35, 3.25]} />
        <meshStandardMaterial color="#1b3833" roughness={0.6} />
      </mesh>

      {/* Ground Floor Store Entrance with Green Awning */}
      <mesh position={[0, 0.7, 1.51]}>
        <boxGeometry args={[3.2, 1.35, 0.05]} />
        <meshStandardMaterial color="#164e63" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.35, 1.75]} rotation={[0.45, 0, 0]} castShadow>
        <boxGeometry args={[3.3, 0.65, 0.08]} />
        <meshStandardMaterial color="#0f766e" roughness={0.7} />
      </mesh>

      {/* 2nd Floor Balcony with White Stone Railings (Reference Detail) */}
      <group position={[-0.8, 2.4, 1.65]}>
        <mesh castShadow>
          <boxGeometry args={[1.3, 0.08, 0.5]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.22, 0.24]}>
          <boxGeometry args={[1.3, 0.38, 0.04]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
        </mesh>
      </group>

      {/* Windows with White Stone Frames & Warm Light */}
      {[-0.8, 0.8].map((wx, i) =>
        [2.6, 3.9].map((wy, j) => (
          <React.Fragment key={`sg-win-${i}-${j}`}>
            <mesh position={[wx, wy, 1.51]}>
              <planeGeometry args={[0.65, 0.85]} />
              <meshBasicMaterial color="#fed7aa" />
            </mesh>
            <mesh position={[wx, wy + 0.48, 1.52]}>
              <boxGeometry args={[0.78, 0.12, 0.08]} />
              <meshStandardMaterial color="#f1f5f9" roughness={0.5} />
            </mesh>
          </React.Fragment>
        ))
      )}

      {/* Classic 5-Step Stoop */}
      <group position={[0.8, 0.15, 1.65]}>
        {[0, 1, 2, 3, 4].map((step) => (
          <mesh
            key={`sg-stoop-${step}`}
            position={[0, step * 0.14, -step * 0.12]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1.1, 0.14, 0.35]} />
            <meshStandardMaterial color="#94a3b8" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// 3. Iconic Apollo Live Theater with Illuminated Marquee & Glowing Neon Blade Sign
function NYCApolloTheater({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Main Theater Facade */}
      <mesh position={[0, 2.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.8, 4.8, 3.2]} />
        <meshStandardMaterial color="#18181b" roughness={0.6} />
      </mesh>

      {/* Gold Trim Cornice */}
      <mesh position={[0, 4.95, 0]} castShadow>
        <boxGeometry args={[4.05, 0.35, 3.45]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* Projecting Tiered Marquee Entrance Canopy */}
      <mesh position={[0, 1.4, 1.8]} castShadow>
        <boxGeometry args={[3.4, 0.38, 1.3]} />
        <meshStandardMaterial color="#090d16" roughness={0.4} metalness={0.8} />
      </mesh>
      {/* Marquee Glowing Trim Line */}
      <mesh position={[0, 1.4, 2.46]}>
        <boxGeometry args={[3.44, 0.14, 0.04]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>

      {/* Vertical Glowing "APOLLO" Blade Signboard */}
      <group position={[0, 3.6, 1.95]}>
        <mesh castShadow>
          <boxGeometry args={[0.65, 2.2, 0.25]} />
          <meshStandardMaterial color="#dc2626" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.14]}>
          <planeGeometry args={[0.55, 2.0]} />
          <meshBasicMaterial color="#fef08a" />
        </mesh>
        <CanvasText
          position={[0, 0, 0.15]}
          text="APOLLO"
          fontSize={38}
          color="#dc2626"
          scale={[0.7, 0.7, 0.7]}
        />
      </group>

      {/* Marquee Text */}
      <CanvasText
        position={[0, 2.0, 1.65]}
        text="★ LIVE AMATEUR NIGHT ★"
        fontSize={22}
        color="#fef08a"
        bgColor="#090d16"
        scale={[0.68, 0.68, 0.68]}
      />

      <pointLight position={[0, 1.1, 2.0]} color="#fef08a" intensity={5.5} distance={5.5} />
    </group>
  );
}

// 4. Stepped Art-Deco Downtown Skyscraper & Financial High-Rise
function NYCSkyscraperTower({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 3.2, 3.0]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 3.8, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 2.2, 2.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.25} metalness={0.8} />
      </mesh>
      <mesh position={[0, 5.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.8, 1.8]} />
        <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.85} />
      </mesh>

      <mesh position={[0, 6.9, 0]} castShadow>
        <coneGeometry args={[0.25, 1.6, 12]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.95} roughness={0.1} />
      </mesh>
      <mesh position={[0, 7.8, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>

      {[-1.0, 0, 1.0].map((wx, i) =>
        [1.0, 2.0].map((wy, j) => (
          <mesh key={`sky-win-1-${i}-${j}`} position={[wx, wy, 1.51]}>
            <planeGeometry args={[0.55, 0.65]} />
            <meshBasicMaterial color="#fed7aa" />
          </mesh>
        ))
      )}
      {[-0.7, 0.7].map((wx, i) => (
        <mesh key={`sky-win-2-${i}`} position={[wx, 3.8, 1.21]}>
          <planeGeometry args={[0.5, 1.4]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      ))}

      <CanvasText
        position={[0, 0.6, 1.52]}
        text="WALL ST PLAZA"
        fontSize={26}
        color="#fbbf24"
        bgColor="#022c22"
        scale={[0.6, 0.6, 0.6]}
      />
    </group>
  );
}

function MiniatureNYCDiorama({ showBuildings = true }: { showBuildings?: boolean }) {
  if (!showBuildings) return null;

  return (
    <group position={[0, 0, 0]}>
      {/* Diorama Central Foundation Platform with Granite Curbs */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[14.4, 0.12, 14.4]} />
        <meshStandardMaterial color="#0f172a" roughness={0.9} />
      </mesh>

      {/* Gold Rim Border around Central Diorama */}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[14.5, 0.02, 14.5]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* 1. NORTH-WEST: DETAILED CORNER BROWNSTONE & 125TH BODEGA */}
      <NYCCornerBrownstoneAndBodega position={[-4.5, 0.12, -4.5]} />

      {/* 2. NORTH-EAST: SAGE GREEN HARLEM BROWNSTONE & STOREFRONT */}
      <NYCSageGreenBrownstone position={[4.5, 0.12, -4.5]} />

      {/* 3. SOUTH-WEST: APOLLO LIVE THEATER & ENTERTAINMENT DISTRICT */}
      <NYCApolloTheater position={[-4.5, 0.12, 4.2]} />

      {/* 4. SOUTH-EAST: DOWNTOWN FINANCIAL SKYSCRAPER & CORPORATE TOWER */}
      <NYCSkyscraperTower position={[4.5, 0.12, 4.2]} />

      {/* 5. CENTRAL PARK GREENERY & PROMENADE (NORTH CENTER) */}
      <group position={[0, 0.12, -4.6]}>
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <boxGeometry args={[4.4, 0.06, 4.2]} />
          <meshStandardMaterial color="#166534" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.065, 0]}>
          <boxGeometry args={[1.2, 0.02, 4.0]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.8} />
        </mesh>
        <MiniatureTree position={[-1.4, 0.06, -1.2]} scale={1.15} />
        <MiniatureTree position={[1.4, 0.06, -1.2]} scale={1.05} />
        <MiniatureTree position={[-1.4, 0.06, 1.2]} scale={0.95} />
        <MiniatureTree position={[1.4, 0.06, 1.2]} scale={1.1} />
        <CanvasText
          position={[0, 0.45, 1.8]}
          text="CENTRAL PARK"
          fontSize={28}
          color="#86efac"
          bgColor="#064e3b"
          scale={[0.65, 0.65, 0.65]}
        />
      </group>

      {/* 6. CENTRAL VELVET DICE ROLLING PIT (ICONIC CUSTOM LOGO EMBLEM) */}
      <group position={[0, 0.12, 3.2]}>
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <cylinderGeometry args={[2.2, 2.3, 0.12, 32]} />
          <meshStandardMaterial color="#022c22" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <torusGeometry args={[2.25, 0.08, 12, 48]} rotation={[-Math.PI / 2, 0, 0]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.95} roughness={0.1} />
        </mesh>
        <DicePitLogoTexture />
      </group>
    </group>
  );
}

// =========================================================================
// POP-UP 3D MINIATURE JAIL BUILDING (Rises only during Jail Event)
// =========================================================================
function PopUpJailBuilding({
  progress,
  jailedCharacterStyle,
}: {
  progress: number;
  jailedCharacterStyle: 'streetwear' | 'tycoon' | null;
}) {
  if (progress <= 0.001) return null;

  const baseY = THREE.MathUtils.lerp(-4.5, 0.25, progress);

  return (
    <group position={[8.8, baseY, 8.8]} rotation={[0, Math.PI / 4, 0]}>
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[2.85, 0.4, 2.85]} />
        <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[2.92, 0.06, 2.92]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} />
      </mesh>

      <mesh position={[0, 1.45, -1.25]} castShadow receiveShadow>
        <boxGeometry args={[2.8, 2.8, 0.35]} />
        <meshStandardMaterial color="#334155" roughness={0.85} />
      </mesh>
      <mesh position={[-1.25, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.35, 2.8, 2.85]} />
        <meshStandardMaterial color="#334155" roughness={0.85} />
      </mesh>
      <mesh position={[1.25, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.35, 2.8, 2.85]} />
        <meshStandardMaterial color="#334155" roughness={0.85} />
      </mesh>

      {/* Front Iron Bars */}
      {[-0.95, -0.62, 0.62, 0.95].map((bx, idx) => (
        <mesh key={`fbar-${idx}`} position={[bx, 1.35, 1.28]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 2.4, 10]} />
          <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
        </mesh>
      ))}

      {[0.5, 1.4, 2.2].map((by, idx) => (
        <mesh key={`hbar-${idx}`} position={[0, by, 1.28]} castShadow>
          <boxGeometry args={[2.45, 0.06, 0.06]} />
          <meshStandardMaterial color="#09090b" roughness={0.3} metalness={0.9} />
        </mesh>
      ))}

      <group position={[0, 2.65, 1.35]}>
        <mesh castShadow>
          <boxGeometry args={[2.5, 0.45, 0.12]} />
          <meshStandardMaterial color="#090d16" roughness={0.4} metalness={0.7} />
        </mesh>
        <CanvasText
          position={[0, 0, 0.08]}
          text="NYC JAIL & COURT"
          fontSize={30}
          color="#fbbf24"
          scale={[0.75, 0.75, 0.75]}
        />
      </group>

      <pointLight position={[0, 2.3, 0]} color="#f59e0b" intensity={5.0} distance={4.5} />
    </group>
  );
}

// =========================================================================
// 3D BOARD TILES (Flat & Unobstructed during normal gameplay)
// =========================================================================
function BoardTile({
  space,
  index,
  ownership,
  isSelected,
  onSelect,
}: {
  space: BoardSpaceConfig;
  index: number;
  ownership?: PropertyOwnership;
  isSelected: boolean;
  onSelect: (index: number) => void;
}) {
  const pos = useMemo(() => getSpacePosition(index), [index]);
  const rot = useMemo(() => getSpaceRotation(index), [index]);
  const isCorner = space.type === 'corner';
  const sizeX = isCorner ? 2.4 : 2.0;
  const sizeZ = isCorner ? 2.4 : 2.0;

  const ownerColor =
    ownership?.ownerId === 0 ? '#38bdf8' : ownership?.ownerId === 1 ? '#fbbf24' : null;

  if (space.id === 8) {
    return (
      <group
        position={pos}
        rotation={rot}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(index);
        }}
      >
        <mesh receiveShadow castShadow>
          <boxGeometry args={[sizeX, 0.35, sizeZ]} />
          <meshStandardMaterial
            color={isSelected ? '#374151' : '#1e293b'}
            roughness={0.7}
            metalness={0.3}
          />
        </mesh>
        <mesh position={[0, 0.18, 0]}>
          <boxGeometry args={[sizeX * 0.92, 0.02, sizeZ * 0.92]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        {[-0.6, -0.2, 0.2, 0.6].map((gx, idx) => (
          <mesh key={`grate-l-${idx}`} position={[gx, 0.19, 0]}>
            <boxGeometry args={[0.04, 0.02, sizeZ * 0.85]} />
            <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        <CanvasText
          position={[0, 0.21, 0.4]}
          rotation={[-Math.PI / 2, 0, 0]}
          text="NYC JAIL"
          fontSize={28}
          color="#ef4444"
          scale={[0.75, 0.75, 0.75]}
        />
        <CanvasText
          position={[0, 0.21, -0.4]}
          rotation={[-Math.PI / 2, 0, 0]}
          text="& COURT"
          fontSize={22}
          color="#fbbf24"
          scale={[0.65, 0.65, 0.65]}
        />
      </group>
    );
  }

  const shortLabel = space.name
    .replace('Brownstone', 'B-STONE')
    .replace('Storefront', 'STORE')
    .replace('Recording Studio', 'STUDIO')
    .replace('Live Theater', 'THEATER')
    .replace('Warehouse', 'WHOUSE')
    .replace('Depot & Gas', 'DEPOT')
    .replace('Flea Market', 'MARKET')
    .replace('Bazaar', 'BAZAAR')
    .replace('Banking Plaza', 'PLAZA')
    .replace('Financial Tower', 'TOWER')
    .replace('Heliport', 'HELIPORT')
    .replace('Penthouse', 'PENTHOUSE')
    .replace('Estate', 'ESTATE')
    .replace('START THE HUSTLE', 'START $200')
    .replace('CITY BREAK', 'FREE PARK')
    .replace('GO TO JAIL', 'GO TO JAIL')
    .replace('Community Chest', 'CHEST')
    .replace('Hustle Opportunity', 'CHANCE')
    .replace('City Tax Levy', 'TAX $150')
    .replace('Luxury Sales Tax', 'TAX $200');

  return (
    <group
      position={pos}
      rotation={rot}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(index);
      }}
    >
      <mesh receiveShadow castShadow>
        <boxGeometry args={[sizeX, 0.35, sizeZ]} />
        <meshStandardMaterial
          color={isSelected ? '#374151' : '#18181b'}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>

      {space.type === 'property' && (
        <mesh position={[0, 0.18, -sizeZ * 0.36]}>
          <boxGeometry args={[sizeX * 0.94, 0.04, sizeZ * 0.24]} />
          <meshStandardMaterial color={space.color} roughness={0.4} />
        </mesh>
      )}

      {space.type !== 'property' && (
        <mesh position={[0, 0.18, 0]}>
          <boxGeometry args={[sizeX * 0.92, 0.02, sizeZ * 0.92]} />
          <meshStandardMaterial color={space.color} roughness={0.5} transparent opacity={0.85} />
        </mesh>
      )}

      <CanvasText
        position={[0, 0.21, space.type === 'property' ? 0.05 : 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        text={shortLabel}
        fontSize={26}
        color={space.type === 'property' ? '#f8fafc' : '#ffffff'}
        scale={[0.75, 0.75, 0.75]}
      />

      {space.type === 'property' && space.price && (
        <CanvasText
          position={[0, 0.21, 0.55]}
          rotation={[-Math.PI / 2, 0, 0]}
          text={`$${space.price}`}
          fontSize={22}
          color="#fbbf24"
          scale={[0.65, 0.65, 0.65]}
        />
      )}

      {ownerColor && (
        <mesh position={[0, 0.2, sizeZ * 0.38]}>
          <boxGeometry args={[sizeX * 0.85, 0.05, sizeZ * 0.16]} />
          <meshStandardMaterial color={ownerColor} metalness={0.6} roughness={0.2} />
        </mesh>
      )}
    </group>
  );
}

// =========================================================================
// PHYSICAL HAND-TO-DICE ROLL SYSTEM
// =========================================================================
function getTargetDieEuler(value: number): [number, number, number] {
  switch (value) {
    case 1:
      return [0, 0, 0];
    case 6:
      return [Math.PI, 0, 0];
    case 2:
      return [Math.PI / 2, 0, 0];
    case 5:
      return [-Math.PI / 2, 0, 0];
    case 3:
      return [0, 0, -Math.PI / 2];
    case 4:
      return [0, 0, Math.PI / 2];
    default:
      return [0, 0, 0];
  }
}

function DieMesh({ value }: { value: number }) {
  const pipColor = '#0f172a';
  const pipSize = 0.055;

  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshStandardMaterial color="#fefbf3" roughness={0.25} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.355, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.085, 16]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
      {[-0.18, 0, 0.18].map((pz, i) =>
        [-0.18, 0.18].map((px, j) => (
          <mesh key={`f6-${i}-${j}`} position={[px, -0.355, pz]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[pipSize, 12]} />
            <meshBasicMaterial color={pipColor} />
          </mesh>
        ))
      )}
      <mesh position={[-0.18, -0.18, 0.355]}>
        <circleGeometry args={[pipSize, 12]} />
        <meshBasicMaterial color={pipColor} />
      </mesh>
      <mesh position={[0.18, 0.18, 0.355]}>
        <circleGeometry args={[pipSize, 12]} />
        <meshBasicMaterial color={pipColor} />
      </mesh>
      {[
        [-0.18, -0.18],
        [0.18, -0.18],
        [0, 0],
        [-0.18, 0.18],
        [0.18, 0.18],
      ].map(([px, py], i) => (
        <mesh key={`f5-${i}`} position={[px, py, -0.355]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[pipSize, 12]} />
          <meshBasicMaterial color={pipColor} />
        </mesh>
      ))}
      {[
        [-0.18, -0.18],
        [0, 0],
        [0.18, 0.18],
      ].map(([py, pz], i) => (
        <mesh key={`f3-${i}`} position={[0.355, py, pz]} rotation={[0, Math.PI / 2, 0]}>
          <circleGeometry args={[pipSize, 12]} />
          <meshBasicMaterial color={pipColor} />
        </mesh>
      ))}
      {[
        [-0.18, -0.18],
        [-0.18, 0.18],
        [0.18, -0.18],
        [0.18, 0.18],
      ].map(([py, pz], i) => (
        <mesh key={`f4-${i}`} position={[-0.355, py, pz]} rotation={[0, -Math.PI / 2, 0]}>
          <circleGeometry args={[pipSize, 12]} />
          <meshBasicMaterial color={pipColor} />
        </mesh>
      ))}
    </group>
  );
}

function PhysicalDie({
  id,
  targetValue,
  rollId,
  isRolling,
  onSettle,
  activePlayerIndex,
  throwProgress,
}: {
  id: number;
  targetValue: number;
  rollId: number;
  isRolling: boolean;
  onSettle: () => void;
  activePlayerIndex: number;
  throwProgress: number;
}) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const meshGroupRef = useRef<THREE.Group>(null);
  const rollTimerRef = useRef(0);
  const settledRef = useRef(false);
  const hasReleasedRef = useRef(false);

  useEffect(() => {
    settledRef.current = false;
    hasReleasedRef.current = false;
    rollTimerRef.current = 0;
  }, [rollId]);

  useFrame((_, delta) => {
    if (!bodyRef.current) return;

    if (!isRolling) {
      const restZ = activePlayerIndex === 0 ? 10.5 : -10.5;
      const restX = (id === 0 ? -0.45 : 0.45) * (activePlayerIndex === 0 ? 1 : -1);
      bodyRef.current.setTranslation({ x: restX, y: 0.5, z: restZ }, true);
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (throwProgress < 0.75) {
      const isHuman = activePlayerIndex === 0;
      let handX = isHuman ? 2.4 : -2.4;
      let handY = 1.2;
      let handZ = isHuman ? 11.2 : -11.2;

      if (throwProgress > 0.35) {
        const p = (throwProgress - 0.35) / 0.4;
        handY = THREE.MathUtils.lerp(1.2, 4.2, p);
        handZ = THREE.MathUtils.lerp(isHuman ? 11.2 : -11.2, isHuman ? 9.8 : -9.8, p);
        handX = THREE.MathUtils.lerp(isHuman ? 2.4 : -2.4, isHuman ? 1.6 : -1.6, p);
      }

      const dieOffX = id === 0 ? -0.35 : 0.35;
      bodyRef.current.setTranslation({ x: handX + dieOffX, y: handY, z: handZ }, true);
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: 0 }, true);
      return;
    }

    if (!hasReleasedRef.current) {
      hasReleasedRef.current = true;
      const isHuman = activePlayerIndex === 0;
      const startX = (isHuman ? 1.2 : -1.2) + (id === 0 ? -0.35 : 0.35);
      const startY = 3.6;
      const startZ = isHuman ? 8.5 : -8.5;

      bodyRef.current.setTranslation({ x: startX, y: startY, z: startZ }, true);

      const vz = isHuman ? -9.5 : 9.5;
      const vx = (0 - startX) * 1.8 + (Math.random() - 0.5) * 2.0;
      bodyRef.current.setLinvel({ x: vx, y: -2.0, z: vz }, true);
      bodyRef.current.setAngvel(
        {
          x: (Math.random() - 0.5) * 24,
          y: (Math.random() - 0.5) * 24,
          z: (Math.random() - 0.5) * 24,
        },
        true
      );
      gameAudio.playPowerupChime();
    }

    rollTimerRef.current += delta;

    if (rollTimerRef.current > 1.2 && !settledRef.current) {
      const tEuler = getTargetDieEuler(targetValue);
      const targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(tEuler[0], tEuler[1], tEuler[2])
      );

      const curPos = bodyRef.current.translation();
      const destX = id === 0 ? -0.45 : 0.45;
      const targetX = THREE.MathUtils.lerp(curPos.x, destX, delta * 6);
      const targetY = THREE.MathUtils.lerp(curPos.y, 0.6, delta * 6);
      const targetZ = THREE.MathUtils.lerp(curPos.z, 3.2, delta * 6);

      bodyRef.current.setTranslation({ x: targetX, y: targetY, z: targetZ }, true);
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

      const currentQ = new THREE.Quaternion(
        bodyRef.current.rotation().x,
        bodyRef.current.rotation().y,
        bodyRef.current.rotation().z,
        bodyRef.current.rotation().w
      );
      currentQ.slerp(targetQ, delta * 12);
      bodyRef.current.setRotation(
        { x: currentQ.x, y: currentQ.y, z: currentQ.z, w: currentQ.w },
        true
      );

      if (rollTimerRef.current > 1.8) {
        settledRef.current = true;
        bodyRef.current.setRotation(
          { x: targetQ.x, y: targetQ.y, z: targetQ.z, w: targetQ.w },
          true
        );
        onSettle();
      }
    }
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders="cuboid"
      restitution={0.5}
      friction={0.6}
      linearDamping={0.4}
      angularDamping={0.4}
      position={[id === 0 ? -0.55 : 0.55, 0.6, 3.2]}
      onCollisionEnter={() => {
        if (rollTimerRef.current < 1.2 && hasReleasedRef.current) {
          gameAudio.playJumpLandingThud();
        }
      }}
    >
      <group ref={meshGroupRef}>
        <DieMesh value={targetValue} />
      </group>
    </RigidBody>
  );
}

// =========================================================================
// CINEMATIC CAMERA DIRECTOR (Framed for Full Board, Players & City)
// =========================================================================
function CameraRig({
  cameraMode,
  activePlayerPos,
  activePlayerIndex,
  inspectIndex,
  calibration,
}: {
  cameraMode: CameraViewMode;
  activePlayerPos: number;
  activePlayerIndex: number;
  inspectIndex: number | null;
  calibration: CharacterCalibration;
}) {
  const { camera } = useThree();

  useFrame((_, delta) => {
    if (cameraMode === 'CALIBRATION') {
      // Diagnostic character focus framing
      targetCamPos.set(
        calibration.posX + 3.0,
        calibration.posY + Math.max(calibration.scale * 0.7, 3.5),
        calibration.posZ + 6.0
      );
      targetCamLook.set(
        calibration.posX,
        calibration.posY + Math.max(calibration.scale * 0.45, 2.0),
        calibration.posZ
      );
    } else if (cameraMode === 'OVERVIEW') {
      targetCamPos.set(-21.5, 12.0, 0.0);
      targetCamLook.set(0, 0.2, 0.0);
    } else if (cameraMode === 'PREPARE_ROLL') {
      if (activePlayerIndex === 0) {
        targetCamPos.set(4.5, 4.2, 17.5);
        targetCamLook.set(0.6, 1.8, 11.5);
      } else {
        targetCamPos.set(-4.5, 4.2, -17.5);
        targetCamLook.set(-0.6, 1.8, -11.5);
      }
    } else if (cameraMode === 'DICE') {
      targetCamPos.set(0, 7.8, 8.5);
      targetCamLook.set(0, 0.5, 3.2);
    } else if (cameraMode === 'FOLLOW_CHARACTER') {
      const sp = getSpacePosition(activePlayerPos);
      const heading = getTravelHeading(activePlayerPos);
      const frontDist = 4.2;
      const camX = sp[0] + Math.sin(heading) * frontDist;
      const camZ = sp[2] + Math.cos(heading) * frontDist;
      targetCamPos.set(camX, 3.8, camZ);
      targetCamLook.set(sp[0], 1.2, sp[2]);
    } else if (cameraMode === 'PROPERTY' && inspectIndex !== null) {
      const sp = getSpacePosition(inspectIndex);
      targetCamPos.set(sp[0] * 1.25, 6.2, sp[2] * 1.25 + 3.8);
      targetCamLook.set(sp[0], 0.8, sp[2]);
    } else if (cameraMode === 'JAIL') {
      targetCamPos.set(13.6, 2.2, 13.6);
      targetCamLook.set(8.8, 1.35, 8.8);
    }

    camera.position.lerp(targetCamPos, delta * 3.8);
    currentCamLook.lerp(targetCamLook, delta * 4.2);
    camera.lookAt(currentCamLook);
  });

  return null;
}

// =========================================================================
// MAIN GAME SCENE
// =========================================================================
export interface GameSceneProps {
  players: PlayerState[];
  currentPlayerIndex: number;
  properties: Record<number, PropertyOwnership>;
  selectedSpaceIndex: number;
  onSelectSpace: (index: number) => void;
  diceRoll: { d1: number; d2: number; total: number; rollId: number; isRolling: boolean };
  onDiceSettled: () => void;
  cameraMode: CameraViewMode;
  floatingTexts: FloatingText[];
  isMovingCharacter: boolean;
  throwProgress: number;
  jailEvent: JailEventState;
  calibration: CharacterCalibration;
  onModelDiagnostic?: (info: {
    status: 'loaded' | 'error';
    animations: string[];
    meshCount: number;
    rawBox: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    materialInfo?: string;
  }) => void;
}

export default function GameScene({
  players,
  currentPlayerIndex,
  properties,
  selectedSpaceIndex,
  onSelectSpace,
  diceRoll,
  onDiceSettled,
  cameraMode,
  floatingTexts,
  isMovingCharacter,
  throwProgress,
  jailEvent,
  calibration,
  onModelDiagnostic,
}: GameSceneProps) {
  const settledCountRef = useRef(0);

  const handleDieSettle = () => {
    settledCountRef.current += 1;
    if (settledCountRef.current >= 2) {
      settledCountRef.current = 0;
      onDiceSettled();
    }
  };

  useEffect(() => {
    settledCountRef.current = 0;
  }, [diceRoll.rollId]);

  const isPlayerThrowing = diceRoll.isRolling && currentPlayerIndex === 0;
  const isTycoonThrowing = diceRoll.isRolling && currentPlayerIndex === 1;

  const jailedCharStyle =
    jailEvent.active && players[jailEvent.playerIndex]
      ? players[jailEvent.playerIndex].character
      : null;

  return (
    <>
      {/* Warm Golden-Hour Lighting Rig */}
      <hemisphereLight
        color={getConfig('hemiSkyColor')}
        groundColor={getConfig('hemiGroundColor')}
        intensity={getConfig('hemiIntensity')}
      />
      <ambientLight color={getConfig('ambientColor')} intensity={getConfig('ambientIntensity')} />
      <directionalLight
        position={[14, 25, 16]}
        color={getConfig('sunColor')}
        intensity={getConfig('sunIntensity')}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <directionalLight position={[-14, 16, -14]} intensity={2.4} color="#93c5fd" />

      {/* Key Lighting for MrTalkofNY (South Chair) */}
      <spotLight
        position={[-6, 7, 12]}
        target-position={[0, 0, 14.5]}
        intensity={18}
        distance={25}
        angle={Math.PI / 4}
        penumbra={0.5}
        color="#fffbeb"
      />
      <pointLight position={[0, 3.5, 11.5]} intensity={12} distance={15} color="#fed7aa" />

      {/* Key Lighting for Tycoon (North Chair) */}
      <spotLight
        position={[-6, 7, -12]}
        target-position={[0, 0, -14.5]}
        intensity={14}
        distance={25}
        angle={Math.PI / 4}
        penumbra={0.5}
        color="#fed7aa"
      />
      <pointLight position={[0, 3.5, -11.5]} intensity={10} distance={15} color="#93c5fd" />

      {/* Orbit Controls (Active during OVERVIEW, PROPERTY & CALIBRATION) */}
      <OrbitControls
        enablePan={cameraMode === 'CALIBRATION'}
        enabled={cameraMode === 'OVERVIEW' || cameraMode === 'PROPERTY' || cameraMode === 'CALIBRATION'}
        minDistance={3}
        maxDistance={50}
        maxPolarAngle={Math.PI / 2.05}
        minPolarAngle={Math.PI / 12}
        target={
          cameraMode === 'CALIBRATION'
            ? [calibration.posX, calibration.posY + 2, calibration.posZ]
            : [0, 0, 0]
        }
      />

      <CameraRig
        cameraMode={cameraMode}
        activePlayerPos={players[currentPlayerIndex]?.position ?? 0}
        activePlayerIndex={currentPlayerIndex}
        inspectIndex={selectedSpaceIndex}
        calibration={calibration}
      />

      {/* 1. REALISTIC LIVING ROOM HOUSE ENVIRONMENT */}
      <RealisticHouseEnvironment />

      {/* 2. SOLID WOODEN GAMING TABLE & TWO REALISTIC CHAIRS */}
      <GamingTableAndChairs
        showTable={calibration.showTable}
        showChairs={calibration.showChairs}
        showSeatMarker={calibration.showAxisHelper}
      />

      {/* 3. LIFE-SIZE SEATED PLAYERS AT THE TABLE */}
      <LifeSizeSeatedPlayer
        isCurrentTurn={currentPlayerIndex === 0}
        isThrowing={isPlayerThrowing}
        throwProgress={throwProgress}
        calibration={calibration}
        onModelDiagnostic={onModelDiagnostic}
      />
      {calibration.showChairs && (
        <LifeSizeSeatedTycoon
          isCurrentTurn={currentPlayerIndex === 1}
          isThrowing={isTycoonThrowing}
          throwProgress={throwProgress}
        />
      )}

      {/* 4. PHYSICAL DICE WITH RAPIER PHYSICS */}
      <Physics gravity={[0, getConfig('gravity'), 0]}>
        <RigidBody type="fixed" colliders={false} position={[0, 0, 3.2]}>
          <CuboidCollider args={[2.4, 0.25, 2.4]} position={[0, 0, 0]} />
          <CuboidCollider args={[2.4, 3, 0.15]} position={[0, 1.5, -2.4]} />
          <CuboidCollider args={[2.4, 3, 0.15]} position={[0, 1.5, 2.4]} />
          <CuboidCollider args={[0.15, 3, 2.4]} position={[-2.4, 1.5, 0]} />
          <CuboidCollider args={[0.15, 3, 2.4]} position={[2.4, 1.5, 0]} />
        </RigidBody>

        <PhysicalDie
          id={0}
          targetValue={diceRoll.d1}
          rollId={diceRoll.rollId}
          isRolling={diceRoll.isRolling}
          onSettle={handleDieSettle}
          activePlayerIndex={currentPlayerIndex}
          throwProgress={throwProgress}
        />
        <PhysicalDie
          id={1}
          targetValue={diceRoll.d2}
          rollId={diceRoll.rollId}
          isRolling={diceRoll.isRolling}
          onSettle={handleDieSettle}
          activePlayerIndex={currentPlayerIndex}
          throwProgress={throwProgress}
        />
      </Physics>

      {/* 5. 32 3D BOARD SPACES */}
      {calibration.showBoard &&
        BOARD_SPACES.map((space, idx) => (
          <BoardTile
            key={`tile-${space.id}`}
            space={space}
            index={idx}
            ownership={properties[idx]}
            isSelected={selectedSpaceIndex === idx}
            onSelect={onSelectSpace}
          />
        ))}

      {/* POP-UP JAIL BUILDING */}
      <PopUpJailBuilding
        progress={jailEvent.progress}
        jailedCharacterStyle={jailedCharStyle}
      />

      {/* 6. CENTRAL NYC MINIATURE CITY DIORAMA */}
      <MiniatureNYCDiorama showBuildings={calibration.showBuildings} />

      {/* 7. OUTER PERIMETER ROAD SYSTEM & ANIMATED NYC VEHICLES */}
      {calibration.showBuildings && <OuterPerimeterRoadAndTraffic />}

      {/* 8. MINIATURE BOARD-GAME PIECES */}
      {calibration.showBoard &&
        players.map((p, idx) => {
          const isJailedHere = jailEvent.active && jailEvent.playerIndex === idx;
          const basePos = getSpacePosition(p.position);
          let heading = getTravelHeading(p.position);

          const sameTile = players[0].position === players[1].position && !p.inJail;
          const offX = sameTile ? (idx === 0 ? -0.35 : 0.35) : 0;

          let charPos: [number, number, number] = [
            basePos[0] + offX,
            p.inJail ? 0.3 : 0.35,
            basePos[2],
          ];

          if (isJailedHere) {
            const jailY = THREE.MathUtils.lerp(-4.5, 0.25, jailEvent.progress);
            charPos = [8.8, jailY + 0.18, 8.8];
            heading = Math.PI / 4;
          }

          return (
            <group key={`player-token-${p.id}`} position={charPos}>
              {p.character === 'streetwear' ? (
                <group scale={[0.65, 0.65, 0.65]} rotation={[0, heading, 0]}>
                  {currentPlayerIndex === idx && !p.inJail && (
                    <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                      <ringGeometry args={[0.7, 0.95, 32]} />
                      <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} transparent opacity={0.8} />
                    </mesh>
                  )}
                  <mesh position={[-0.2, 0.35, 0]} castShadow>
                    <cylinderGeometry args={[0.12, 0.13, 0.65, 12]} />
                    <meshStandardMaterial color="#1e3a8a" roughness={0.7} />
                  </mesh>
                  <mesh position={[0.2, 0.35, 0]} castShadow>
                    <cylinderGeometry args={[0.12, 0.13, 0.65, 12]} />
                    <meshStandardMaterial color="#1e3a8a" roughness={0.7} />
                  </mesh>
                  <mesh position={[-0.2, 0.08, 0.06]} castShadow>
                    <boxGeometry args={[0.22, 0.2, 0.4]} />
                    <meshStandardMaterial color="#c29b38" />
                  </mesh>
                  <mesh position={[0.2, 0.08, 0.06]} castShadow>
                    <boxGeometry args={[0.22, 0.2, 0.4]} />
                    <meshStandardMaterial color="#c29b38" />
                  </mesh>
                  <mesh position={[0, 1.0, 0]} castShadow>
                    <boxGeometry args={[0.7, 0.7, 0.46]} />
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh position={[0, 1.15, 0.24]}>
                    <torusGeometry args={[0.16, 0.025, 8, 20]} />
                    <meshStandardMaterial color="#fbbf24" metalness={0.9} />
                  </mesh>
                  <mesh position={[0, 1.55, 0]} castShadow>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#78431e" />
                  </mesh>
                  <mesh position={[0, 1.58, 0.23]}>
                    <boxGeometry args={[0.38, 0.1, 0.05]} />
                    <meshStandardMaterial color="#090d16" metalness={0.9} />
                  </mesh>
                  <group position={[0, 1.7, 0]}>
                    <mesh castShadow>
                      <sphereGeometry args={[0.26, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
                      <meshStandardMaterial color="#0a1128" />
                    </mesh>
                    <mesh position={[0, -0.02, 0.28]} rotation={[0.2, 0, 0]} castShadow>
                      <boxGeometry args={[0.34, 0.04, 0.26]} />
                      <meshStandardMaterial color="#0a1128" />
                    </mesh>
                  </group>
                </group>
              ) : (
                <group scale={[0.65, 0.65, 0.65]} rotation={[0, heading, 0]}>
                  {currentPlayerIndex === idx && !p.inJail && (
                    <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                      <ringGeometry args={[0.7, 0.95, 32]} />
                      <meshBasicMaterial color="#fbbf24" side={THREE.DoubleSide} transparent opacity={0.8} />
                    </mesh>
                  )}
                  <mesh position={[-0.18, 0.35, 0]} castShadow>
                    <cylinderGeometry args={[0.11, 0.12, 0.65, 12]} />
                    <meshStandardMaterial color="#18181b" />
                  </mesh>
                  <mesh position={[0.18, 0.35, 0]} castShadow>
                    <cylinderGeometry args={[0.11, 0.12, 0.65, 12]} />
                    <meshStandardMaterial color="#18181b" />
                  </mesh>
                  <mesh position={[0, 0.95, 0]} castShadow>
                    <boxGeometry args={[0.66, 0.7, 0.42]} />
                    <meshStandardMaterial color="#09090b" />
                  </mesh>
                  <mesh position={[0, 1.0, 0.22]}>
                    <boxGeometry args={[0.22, 0.5, 0.02]} />
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  <mesh position={[0, 1.5, 0]} castShadow>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#fef08a" />
                  </mesh>
                  <mesh position={[0, 1.44, 0.24]}>
                    <boxGeometry args={[0.3, 0.08, 0.08]} />
                    <meshStandardMaterial color="#111827" />
                  </mesh>
                  <group position={[0, 1.74, 0]}>
                    <mesh castShadow>
                      <cylinderGeometry args={[0.38, 0.38, 0.04, 20]} />
                      <meshStandardMaterial color="#09090b" />
                    </mesh>
                    <mesh position={[0, 0.3, 0]} castShadow>
                      <cylinderGeometry args={[0.24, 0.26, 0.6, 20]} />
                      <meshStandardMaterial color="#09090b" />
                    </mesh>
                    <mesh position={[0, 0.08, 0]}>
                      <cylinderGeometry args={[0.26, 0.26, 0.08, 20]} />
                      <meshStandardMaterial color="#fbbf24" metalness={0.9} />
                    </mesh>
                  </group>
                </group>
              )}
            </group>
          );
        })}

      {/* Floating 3D Text Notifications */}
      {floatingTexts.map((ft) => (
        <Float key={ft.id} speed={2} rotationIntensity={0.2} floatIntensity={1}>
          <CanvasText
            position={ft.position}
            text={ft.text}
            fontSize={36}
            color={ft.color}
            scale={[1.1, 1.1, 1.1]}
          />
        </Float>
      ))}
    </>
  );
}
