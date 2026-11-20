import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import './App.css'
import monsterBreathAudio from './assets/audio/monster-breath.wav?inline'
import monsterChaseAudio from './assets/audio/monster-chase.wav?inline'
import monsterAttackAudio from './assets/audio/monster-attack.wav?inline'
import elevatorDoorOpenAudio from './assets/audio/elevator-door-open.wav?inline'
import elevatorDoorCloseAudio from './assets/audio/elevator-door-close.wav?inline'
import elevatorMotorStartAudio from './assets/audio/elevator-motor-start.wav?inline'
import elevatorMotorLoopAudio from './assets/audio/elevator-motor-loop.wav?inline'
import elevatorMotorStopAudio from './assets/audio/elevator-motor-stop.wav?inline'

const WALLS = [
  // x, z, width, depth
  [-6.2, -7, 0.45, 40], [6.2, -7, 0.45, 40],
  [-4, -26.8, 4.8, 0.45], [4, -26.8, 4.8, 0.45], [0, 12.8, 12.8, 0.45],
  [-3.9, -18, 4.5, 0.35], [3.9, -18, 4.5, 0.35],
  [-3.9, 3, 4.5, 0.35], [3.9, 3, 4.5, 0.35],
]

function Box({ position, scale, color = '#2e3630', roughness = 0.78, metalness = 0.35, ...props }) {
  return <mesh position={position} scale={scale} castShadow receiveShadow {...props}>
    <boxGeometry />
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  </mesh>
}

function StripLight({ position, color = '#e8e2d0', intensity = 1.5, rotation = [0, 0, 0], flicker = false, lit = true, powered = false }) {
  const lamp = useRef()
  const tube = useRef()
  useFrame(({ clock }) => {
    const pulse = flicker && Math.sin(clock.elapsedTime * 19 + position[2]) > 0.91 ? 0.18 : 1
    if (lamp.current) lamp.current.intensity = intensity * pulse
    if (tube.current) tube.current.emissiveIntensity = (powered ? 2.6 : (lit ? 0.9 : 0.18)) * pulse
  })
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0, 0]} scale={[1.7, 0.08, 0.13]} color="#101b20" />
    <mesh position={[0, -0.05, 0]}><boxGeometry args={[1.45, 0.035, 0.075]} /><meshStandardMaterial ref={tube} color={color} emissive={color} emissiveIntensity={powered ? 2.6 : (lit ? 0.9 : 0.18)} /></mesh>
    {lit && <pointLight ref={lamp} color={color} intensity={intensity} distance={10} decay={1.55} position={[0, -0.18, 0]} />}
  </group>
}

const CONSOLES = [
  { id: 'power', name: 'POWER CONTROL', position: [-4.55, 0, -2.4], rotation: [0, -Math.PI / 2, 0], accent: '#43c8e5', kind: 'REACTOR' },
  { id: 'security', name: 'SECURITY TERMINAL', position: [4.55, 0, -9.2], rotation: [0, Math.PI / 2, 0], accent: '#58a9ff', kind: 'SECURITY' },
  { id: 'research', name: 'RESEARCH STATION', position: [-4.55, 0, -14.5], rotation: [0, -Math.PI / 2, 0], accent: '#fa665e', kind: 'BIO LAB' },
  { id: 'archive', name: 'ARCHIVE TERMINAL', position: [4.55, 0, 4.5], rotation: [0, Math.PI / 2, 0], accent: '#59e0ae', kind: 'ARCHIVE' },
]

const FUSE_POSITION = [2.55, -0.02, -5.35]
const SCANNER_POSITION = [-2.6, -0.02, -16.25]
const HANDGUN_POSITION = [-7.2, -0.02, -53.4]
const OPENING_CUTSCENE_DURATION = 10.2
const VIEWMODEL_LAYER = 2
const mazeCellKey = ([col, row]) => `${col},${row}`
const mazeEdgeKey = (a, b) => [mazeCellKey(a), mazeCellKey(b)].sort().join('|')
const MAZE_OPEN_EDGES = new Set()
const connectMazeCells = (a, b) => MAZE_OPEN_EDGES.add(mazeEdgeKey(a, b))
// The old sparse route is replaced by a connected 5 x 11 corridor network. A
// serpentine backbone guarantees access to every cell, while offset cross-links
// make loops and multi-way junctions; four moved links preserve real dead ends.
for (let row = 0; row <= 10; row++) {
  for (let col = 0; col < 4; col++) connectMazeCells([col,row],[col+1,row])
}
const shiftedDeadEndRows = new Set([2,4,6,8])
const extraCrossLinks = [1,3,2,1,3,2,1,3,2,1]
const additionalLoops = new Map([[1,2],[4,1],[7,2],[9,3]])
for (let row = 0; row < 10; row++) {
  const mainColumn = shiftedDeadEndRows.has(row) ? 0 : (row % 2 === 0 ? 4 : 0)
  connectMazeCells([mainColumn,row],[mainColumn,row+1])
  connectMazeCells([extraCrossLinks[row],row],[extraCrossLinks[row],row+1])
  const loopColumn = additionalLoops.get(row)
  if (loopColumn !== undefined) connectMazeCells([loopColumn,row],[loopColumn,row+1])
}
const mazeCellPosition = ([col, row]) => [(col - 2) * 4, -29 - row * 4]
const MAZE_EXIT_CELL = [2,10]
const MAZE_COLLIDERS = (() => {
  const walls = []
  const push = (x, z, width, depth) => walls.push({ x, z, halfX: width / 2, halfZ: depth / 2 })
  for (let row = 0; row <= 10; row++) {
    for (let col = 0; col < 5; col++) {
      const x = (col - 2) * 4, z = -29 - row * 4
      if (col === 0) push(-10, z, 0.22, 4)
      if (col < 4) {
        const edgeOpen = MAZE_OPEN_EDGES.has(mazeEdgeKey([col, row], [col + 1, row]))
        const boundaryX = -10 + (col + 1) * 4
        if (edgeOpen) { push(boundaryX, z - 1.65, 0.22, 0.7); push(boundaryX, z + 1.65, 0.22, 0.7) }
        else push(boundaryX, z, 0.22, 4)
      } else push(10, z, 0.22, 4)
      if (row === 0) {
        if (col !== 2) push(x, -27, 4, 0.22)
      } else {
        const edgeOpen = MAZE_OPEN_EDGES.has(mazeEdgeKey([col, row - 1], [col, row]))
        const boundaryZ = -27 - row * 4
        if (edgeOpen) { push(x - 1.65, boundaryZ, 0.7, 0.22); push(x + 1.65, boundaryZ, 0.7, 0.22) }
        else push(x, boundaryZ, 4, 0.22)
      }
      if (row === 10 && col !== 2) push(x, -71, 4, 0.22)
    }
  }
  return walls
})()

let audioContext, masterGain, masterCompressor, ambienceGain, ambienceSources = [], ambienceTimer = null, elevatorHum = null
const activeAudioSources = new Set()
const AUDIO_ASSETS = {
  monsterBreath: monsterBreathAudio, chase: monsterChaseAudio, monsterAttack: monsterAttackAudio,
  elevatorDoorOpen: elevatorDoorOpenAudio, elevatorDoorClose: elevatorDoorCloseAudio,
  elevatorMotorStart: elevatorMotorStartAudio, elevatorMotorLoop: elevatorMotorLoopAudio,
  elevatorMotorStop: elevatorMotorStopAudio,
}
const decodedAudioAssets = Object.create(null)
let audioAssetsPromise = null
let audioSettings = { enabled: true, volume: 0.78, started: false }
let lastPlayerStep = -Infinity
const outputMixGain = (volume) => Math.min(1.5, Math.max(0, volume) * 1.5)
function applyAudioSettings(enabled = audioSettings.enabled, volume = audioSettings.volume) {
  audioSettings = { ...audioSettings, enabled, volume }
  if (masterGain && audioContext) {
    const now = audioContext.currentTime
    masterGain.gain.cancelScheduledValues(now)
    masterGain.gain.setTargetAtTime(enabled ? outputMixGain(volume) : 0, now, 0.04)
  }
}
function ensureAudio() {
  if (typeof window === 'undefined') return null
  const AudioCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioCtor) return null
  if (!audioContext) {
    audioContext = new AudioCtor()
    masterGain = audioContext.createGain()
    masterCompressor = audioContext.createDynamicsCompressor()
    masterCompressor.threshold.value = -8
    masterCompressor.knee.value = 12
    masterCompressor.ratio.value = 5
    masterCompressor.attack.value = 0.004
    masterCompressor.release.value = 0.18
    masterGain.gain.value = audioSettings.enabled ? outputMixGain(audioSettings.volume) : 0
    masterGain.connect(masterCompressor)
    masterCompressor.connect(audioContext.destination)
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
  return audioContext
}
function preloadAudioAssets() {
  if (audioAssetsPromise) return audioAssetsPromise
  const ctx = ensureAudio()
  if (!ctx) return Promise.resolve()
  audioAssetsPromise = Promise.all(Object.entries(AUDIO_ASSETS).map(async ([name, dataUrl]) => {
    const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1), binary = atob(encoded), bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    decodedAudioAssets[name] = await ctx.decodeAudioData(bytes.buffer)
  })).catch(() => { audioAssetsPromise = null })
  return audioAssetsPromise
}
function playAudioAsset(name, volume = 1) {
  const buffer = decodedAudioAssets[name], ctx = ensureAudio()
  if (!buffer || !ctx) return false
  const source = ctx.createBufferSource(), gain = ctx.createGain()
  source.buffer = buffer
  gain.gain.value = volume
  source.connect(gain); gain.connect(masterGain)
  source.onended = () => activeAudioSources.delete(source)
  source.start(); activeAudioSources.add(source)
  return true
}
function startFacilityAmbience() {
  const ctx = ensureAudio()
  if (!ctx || ambienceSources.length) return
  ambienceGain = ctx.createGain()
  ambienceGain.gain.setValueAtTime(0.0001, ctx.currentTime)
  ambienceGain.gain.setTargetAtTime(0.76, ctx.currentTime, 1.8)
  ambienceGain.connect(masterGain)
  const hum = (frequency, volume) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = 'sine'; osc.frequency.value = frequency; gain.gain.value = volume
    osc.connect(gain); gain.connect(ambienceGain); osc.start(); ambienceSources.push(osc)
  }
  hum(43, 0.13); hum(57.4, 0.06); hum(86, 0.028)
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.2
  const air = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), airGain = ctx.createGain()
  air.buffer = buffer; air.loop = true; filter.type = 'lowpass'; filter.frequency.value = 360; airGain.gain.value = 0.36
  air.connect(filter); filter.connect(airGain); airGain.connect(ambienceGain); air.start(); ambienceSources.push(air)
  const scheduleDetail = () => {
    if (!ambienceSources.length || !audioSettings.started) return
    const details = ['pipe', 'drip', 'bang', 'electrical', 'distant']
    playSfx(details[Math.floor(Math.random() * details.length)])
    ambienceTimer = window.setTimeout(scheduleDetail, 9000 + Math.random() * 15000)
  }
  ambienceTimer = window.setTimeout(scheduleDetail, 6000 + Math.random() * 6000)
}
function stopFacilityAmbience() {
  if (ambienceTimer && typeof window !== 'undefined') window.clearTimeout(ambienceTimer)
  ambienceTimer = null
  if (ambienceGain && audioContext) {
    const now = audioContext.currentTime
    ambienceGain.gain.cancelScheduledValues(now)
    ambienceGain.gain.setTargetAtTime(0.0001, now, 0.035)
  }
  for (const source of ambienceSources) { try { source.stop(audioContext.currentTime + 0.16) } catch {} }
  ambienceSources = []
  ambienceGain = null
}
function startGameAudio() {
  const ctx = ensureAudio()
  if (!ctx) return
  audioSettings.started = true
  void preloadAudioAssets()
  startFacilityAmbience()
}
function startElevatorHum() {
  if (elevatorHum || !audioSettings.started || !audioSettings.enabled) return
  const ctx = ensureAudio()
  if (!ctx) return
  const now = ctx.currentTime, output = ctx.createGain(), sources = []
  output.gain.setValueAtTime(0.0001, now)
  output.connect(masterGain)
  if (decodedAudioAssets.elevatorMotorLoop) {
    const source = ctx.createBufferSource()
    source.buffer = decodedAudioAssets.elevatorMotorLoop; source.loop = true
    output.gain.linearRampToValueAtTime(0.82, now + 0.7)
    source.connect(output); source.onended = () => activeAudioSources.delete(source)
    source.start(now); activeAudioSources.add(source); sources.push(source)
    elevatorHum = { output, sources }
    return
  }
  output.gain.linearRampToValueAtTime(0.38, now + 0.7)
  const addTone = (frequency, type, level, cutoff) => {
    const oscillator = ctx.createOscillator(), voice = ctx.createGain()
    oscillator.type = type; oscillator.frequency.value = frequency; voice.gain.value = level
    if (cutoff) {
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff
      oscillator.connect(voice); voice.connect(filter); filter.connect(output)
    } else { oscillator.connect(voice); voice.connect(output) }
    oscillator.onended = () => activeAudioSources.delete(oscillator)
    oscillator.start(now); activeAudioSources.add(oscillator); sources.push(oscillator)
  }
  addTone(34, 'sine', 0.44)
  addTone(72, 'triangle', 0.16)
  addTone(49, 'sawtooth', 0.045, 150)
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.18
  const rumble = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), airGain = ctx.createGain()
  rumble.buffer = buffer; rumble.loop = true; filter.type = 'lowpass'; filter.frequency.value = 190; airGain.gain.value = 0.12
  rumble.connect(filter); filter.connect(airGain); airGain.connect(output)
  rumble.onended = () => activeAudioSources.delete(rumble)
  rumble.start(now); activeAudioSources.add(rumble); sources.push(rumble)
  elevatorHum = { output, sources }
}
function stopElevatorHum() {
  if (!elevatorHum || !audioContext) return
  const now = audioContext.currentTime, { output, sources } = elevatorHum
  output.gain.cancelScheduledValues(now)
  output.gain.setTargetAtTime(0.0001, now, 0.12)
  for (const source of sources) { try { source.stopAfterFade ? source.stopAfterFade(0.65) : source.stop(now + 0.65) } catch {} }
  elevatorHum = null
}
function stopAudioVoices() {
  stopElevatorHum()
  for (const source of activeAudioSources) { try { source.stop() } catch {} }
  activeAudioSources.clear()
}
function playSfx(kind) {
  if (!audioSettings.started || !audioSettings.enabled) return
  const ctx = ensureAudio()
  if (!ctx) return
  const now = ctx.currentTime
  const assetVolume = { monsterBreath: 0.88, chase: 0.88, monsterAttack: 0.95, elevatorDoorOpen: 0.82, elevatorDoorClose: 0.9, elevatorMotorStart: 0.84, elevatorMotorStop: 0.9 }[kind]
  if (assetVolume && playAudioAsset(kind, assetVolume)) return
  const tone = (frequency, duration, wave = 'sine', volume = 0.06, endFrequency = frequency, delay = 0, destination = masterGain) => {
    volume *= 1.32
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = wave; osc.frequency.setValueAtTime(frequency, now + delay)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + delay + duration)
    gain.gain.setValueAtTime(0.0001, now + delay); gain.gain.exponentialRampToValueAtTime(volume, now + delay + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration)
    osc.connect(gain); gain.connect(destination); osc.onended = () => activeAudioSources.delete(osc)
    activeAudioSources.add(osc); osc.start(now + delay); osc.stop(now + delay + duration + 0.03)
  }
  const noise = (duration, volume, filterFrequency = 500, destination = masterGain, delay = 0) => {
    volume *= 1.32
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate), data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain()
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = filterFrequency
    gain.gain.setValueAtTime(volume, now + delay); gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration)
    source.connect(filter); filter.connect(gain); gain.connect(destination); source.onended = () => activeAudioSources.delete(source)
    activeAudioSources.add(source); source.start(now + delay)
  }
  if (kind === 'fuse') { noise(0.12, 0.035, 1600); tone(410, 0.2, 'triangle', 0.04, 760, 0.04) }
  if (kind === 'power') { tone(62, 1.45, 'sawtooth', 0.035, 39); tone(176, 0.48, 'sine', 0.03, 260, 0.28); tone(260, 0.5, 'sine', 0.035, 410, 0.65); tone(410, 0.65, 'sine', 0.035, 620, 1.04) }
  if (kind === 'terminal') { noise(0.055, 0.018, 2200); tone(510, 0.095, 'sine', 0.018, 710) }
  if (kind === 'select') { tone(660, 0.065, 'sine', 0.012, 530); noise(0.035, 0.008, 2800) }
  if (kind === 'scanner') { tone(920, 0.68, 'sine', 0.05, 84); tone(125, 0.55, 'triangle', 0.028, 34, 0.015); tone(580, 0.42, 'sine', 0.018, 170, 0.18); noise(0.34, 0.022, 1250) }
  if (kind === 'discovery') { tone(360, 0.2, 'sine', 0.026, 520); tone(520, 0.3, 'triangle', 0.02, 720, 0.12); noise(0.15, 0.012, 1300, masterGain, 0.04) }
  if (kind === 'playerWalk' || kind === 'playerRun') {
    if (now - lastPlayerStep < (kind === 'playerRun' ? 0.22 : 0.3)) return
    lastPlayerStep = now
    const running = kind === 'playerRun'
    const volume = running ? 0.13 : 0.09
    noise(running ? 0.17 : 0.14, volume, running ? 1050 : 820)
    noise(0.07, volume * 0.4, 2800, masterGain, 0.008)
    tone(running ? 52 : 72, running ? 0.17 : 0.14, 'triangle', volume * 0.62, running ? 30 : 39)
  }
  if (kind === 'footstep') { noise(0.18, 0.13, 390); tone(56, 0.21, 'triangle', 0.085, 27); noise(0.065, 0.04, 1800, masterGain, 0.025) }
  if (kind === 'chase') { tone(43, 1.45, 'sawtooth', 0.09, 27); tone(69, 1.1, 'triangle', 0.065, 38, 0.12); noise(0.9, 0.075, 360); noise(0.42, 0.055, 1150, masterGain, 0.18) }
  if (kind === 'monsterBreath') { noise(1.05, 0.12, 420); tone(48, 1.08, 'sawtooth', 0.09, 31); tone(57, 0.84, 'triangle', 0.055, 42, 0.78); tone(78, 0.62, 'sawtooth', 0.028, 45, 0.2) }
  if (kind === 'monsterAttack') { noise(0.42, 0.16, 820); tone(82, 0.55, 'sawtooth', 0.13, 28); tone(210, 0.25, 'triangle', 0.06, 64, 0.02); noise(0.22, 0.075, 1800, masterGain, 0.08) }
  if (kind === 'gunshot') { noise(0.19, 0.13, 2100); noise(0.24, 0.085, 520); tone(146, 0.19, 'sawtooth', 0.09, 38); tone(980, 0.055, 'square', 0.025, 280, 0.012) }
  if (kind === 'bulletImpact') { noise(0.095, 0.055, 1400); tone(185, 0.12, 'triangle', 0.032, 76) }
  if (kind === 'monsterImpact') { noise(0.14, 0.07, 720); tone(72, 0.2, 'sawtooth', 0.055, 31); tone(260, 0.075, 'triangle', 0.025, 110) }
  if (kind === 'emptyClick') { tone(1180, 0.035, 'square', 0.025, 720); tone(320, 0.055, 'triangle', 0.014, 185, 0.025) }
  if (kind === 'flashlightOn' || kind === 'flashlightOff') { noise(0.08, 0.025, 1900); tone(kind === 'flashlightOn' ? 780 : 340, 0.12, 'square', 0.018, kind === 'flashlightOn' ? 390 : 180, 0.015) }
  if (kind === 'exit') { noise(0.9, 0.08, 520); tone(76, 0.9, 'sawtooth', 0.075, 34); tone(392, 0.38, 'sine', 0.035, 523, 0.58) }
  if (kind === 'elevatorDoorOpen') { noise(0.72, 0.105, 1450); noise(0.45, 0.075, 3200, masterGain, 0.08); tone(72, 0.82, 'sawtooth', 0.075, 138, 0.04); tone(620, 0.12, 'triangle', 0.035, 250, 0.66) }
  if (kind === 'elevatorDoorClose') { noise(0.68, 0.12, 1050); tone(66, 0.72, 'sawtooth', 0.09, 35); noise(0.24, 0.15, 420, masterGain, 0.58); tone(118, 0.26, 'triangle', 0.08, 54, 0.59) }
  if (kind === 'elevatorMotorStart') { tone(34, 1.05, 'sawtooth', 0.095, 58); tone(62, 0.8, 'triangle', 0.06, 42, 0.12); noise(0.55, 0.06, 260, masterGain, 0.08) }
  if (kind === 'elevatorMotorStop') { tone(62, 1.05, 'sawtooth', 0.09, 28); tone(108, 0.54, 'triangle', 0.055, 43, 0.12); noise(0.36, 0.07, 380, masterGain, 0.5) }
  if (kind === 'death') { noise(0.8, 0.13, 560); tone(78, 1.15, 'sawtooth', 0.12, 24); tone(310, 0.78, 'triangle', 0.055, 36, 0.08) }
  if (kind === 'objective') { tone(430, 0.19, 'sine', 0.025, 620); tone(620, 0.28, 'sine', 0.022, 850, 0.16) }
  if (kind === 'pipe') { tone(118, 0.72, 'triangle', 0.012, 54); noise(0.45, 0.009, 390, masterGain, 0.18) }
  if (kind === 'drip') { tone(620, 0.16, 'sine', 0.014, 270); tone(190, 0.24, 'sine', 0.008, 130, 0.14) }
  if (kind === 'bang') { noise(0.42, 0.025, 230); tone(66, 0.55, 'sawtooth', 0.022, 33, 0.02) }
  if (kind === 'electrical') { noise(0.38, 0.012, 2400); tone(740, 0.28, 'sawtooth', 0.009, 510, 0.03) }
  if (kind === 'distant') { tone(214, 0.9, 'sine', 0.009, 61); tone(218, 1.1, 'triangle', 0.006, 58, 0.03) }
  if (kind === 'alarm') { tone(392, 0.82, 'triangle', 0.023, 344); tone(344, 0.82, 'triangle', 0.019, 392, 0.86); noise(0.2, 0.025, 900, masterGain, 0.82) }
}

function Console({ data, powered }) {
  const { position, rotation, accent, kind, name } = data
  const accentMaterial = <meshStandardMaterial color="#122a30" emissive={accent} emissiveIntensity={powered ? 1.25 : 0.03} roughness={0.28} metalness={0.2} />
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.86, 0]} scale={[1.62, 1.72, 0.94]} color="#182329" metalness={0.72} />
    <Box position={[0, 0.86, -0.48]} scale={[1.52, 1.58, 0.08]} color="#52616a" metalness={0.85} roughness={0.32} />
    <Box position={[0, 1.77, -0.1]} scale={[1.72, 0.13, 0.94]} color="#52616a" metalness={0.78} roughness={0.33} />
    <Box position={[0, 0.04, 0]} scale={[1.88, 0.13, 1.1]} color="#10171b" metalness={0.7} />
    {/* Three individually framed displays */}
    {[-0.49, 0, 0.49].map((x, i) => <group key={x} position={[x, 1.45 + (i === 1 ? 0.12 : 0), -0.545]} rotation={[-0.18, 0, 0]}>
      <mesh><boxGeometry args={[0.44, i === 1 ? 0.48 : 0.38, 0.045]} />{accentMaterial}</mesh>
      <mesh position={[0, 0, -0.026]} rotation={[0, Math.PI, 0]}><planeGeometry args={[0.37, i === 1 ? 0.4 : 0.3]} /><meshBasicMaterial color={powered ? (i === 1 ? '#06212a' : '#06151b') : '#05090b'} /></mesh>
      {powered && [0, 1, 2, 3].slice(0, i === 0 ? 3 : 4).map((line) => <mesh key={line} position={[-0.105 + (line % 2) * 0.07, 0.105 - line * 0.045, -0.024]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[i === 1 ? 0.19 : 0.22, 0.009 + (line % 2) * 0.009]} /><meshBasicMaterial color={line === 3 && i === 1 ? '#de5554' : (i === 2 ? '#65dda5' : accent)} />
      </mesh>)}
      {i === 1 && <Text position={[0, -0.13, -0.02]} rotation={[0, Math.PI, 0]} fontSize={0.055} color={powered ? '#b4e5e4' : '#526065'} anchorX="center">{powered ? kind : 'OFFLINE'}</Text>}
    </group>)}
    <Text position={[0, 1.08, -0.558]} rotation={[-0.18, Math.PI, 0]} fontSize={0.072} color="#b5c8ce" anchorX="center">{name}</Text>
    <Text position={[-0.54, 0.74, -0.56]} rotation={[0, Math.PI, 0]} fontSize={0.05} color="#7bafb1" anchorX="center">SYSTEM STATUS</Text>
    <Text position={[0.45, 0.74, -0.56]} rotation={[0, Math.PI, 0]} fontSize={0.05} color="#7bafb1" anchorX="center">POWER</Text>
    {[-0.62, -0.38, 0.38, 0.62].map((x, i) => <group key={x} position={[x, 0.52, -0.56]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.043, 0.05, 0.04, 12]} /><meshStandardMaterial color="#78848a" metalness={0.86} roughness={0.28} /></mesh>
      {powered && <mesh position={[0, 0.025, -0.002]} rotation={[0, Math.PI, 0]}><circleGeometry args={[0.024, 12]} /><meshBasicMaterial color={i === 2 ? '#ef665e' : i % 2 ? '#54dba6' : '#64d7ed'} /></mesh>}
    </group>)}
    {[-0.43, -0.2, 0.03, 0.26, 0.49].map((x) => <Box key={x} position={[x, 0.24, -0.55]} scale={[0.11, 0.018, 0.025]} color="#8c9ca0" metalness={0.9} />)}
    {/* Lower ventilation grille and corner status beacons */}
    <Box position={[0, 0.12, -0.53]} scale={[0.48, 0.11, 0.025]} color="#0a1114" />
    {Array.from({ length: 8 }, (_, i) => <Box key={i} position={[-0.2 + i * 0.057, 0.12, -0.55]} scale={[0.018, 0.085, 0.018]} color="#68777b" metalness={0.82} />)}
    <mesh position={[-0.73, 1.75, -0.57]}><sphereGeometry args={[0.04, 8, 8]} />{accentMaterial}</mesh>
    <mesh position={[0.73, 1.75, -0.57]}><sphereGeometry args={[0.04, 8, 8]} /><meshStandardMaterial color="#da514c" emissive="#d62e2b" emissiveIntensity={1.3} /></mesh>
  </group>
}

function FusePickup({ position }) {
  const spin = useRef()
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.45 })
  return <group position={position}>
    <mesh position={[0, -0.08, 0]}><cylinderGeometry args={[0.12, 0.12, 0.08, 16]} /><meshStandardMaterial color="#4f5b5c" metalness={0.8} /></mesh>
    <group ref={spin}>
      <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.055, 0.055, 0.42, 12]} /><meshStandardMaterial color="#d5b65e" metalness={0.75} roughness={0.25} /></mesh>
      {[-0.22, 0.22].map((x) => <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.08, 0.08, 0.055, 12]} /><meshStandardMaterial color="#97d6da" emissive="#399aa2" emissiveIntensity={0.6} metalness={0.55} /></mesh>)}
    </group>
    <pointLight position={[0, 0.3, 0]} color="#62cbd4" intensity={0.35} distance={2.5} />
  </group>
}

const MemoizedFusePickup = memo(FusePickup)

function SensingMachine({ position }) {
  const ring = useRef()
  useFrame((_, dt) => { if (ring.current) ring.current.rotation.z += dt * 0.32 })
  return <group position={position}>
    <Box position={[0, -0.04, 0]} scale={[0.58, 0.16, 0.38]} color="#1b282e" metalness={0.75} />
    <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.14, 0.2, 0.14, 16]} /><meshStandardMaterial color="#73848a" metalness={0.82} /></mesh>
    <mesh position={[0, 0.23, 0]}><sphereGeometry args={[0.1, 16, 12]} /><meshStandardMaterial color="#43cde1" emissive="#2cb6c9" emissiveIntensity={1.2} /></mesh>
    <mesh ref={ring} position={[0, 0.18, 0]}><torusGeometry args={[0.27, 0.018, 8, 24]} /><meshStandardMaterial color="#71d9e3" emissive="#4dd5e3" emissiveIntensity={0.65} /></mesh>
    <pointLight position={[0, 0.36, 0]} color="#4fc9d9" intensity={0.42} distance={2.8} />
  </group>
}

function PowerMachinery() {
  const fan = useRef()
  useFrame((_, dt) => { if (fan.current) fan.current.rotation.z += dt * 2.1 })
  return <group position={[5.72, 2.05, -21.5]} rotation={[0, Math.PI / 2, 0]}>
    <Box position={[0, 0, 0]} scale={[1.1, 1.25, 0.24]} color="#26373c" metalness={0.82} />
    <mesh position={[0, 0, -0.15]}><torusGeometry args={[0.39, 0.045, 8, 24]} /><meshStandardMaterial color="#667b80" metalness={0.8} /></mesh>
    <group ref={fan} position={[0, 0, -0.16]}>
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((r) => <Box key={r} position={[0, 0, 0]} rotation={[0, 0, r]} scale={[0.07, 0.34, 0.035]} color="#68bac4" metalness={0.65} />)}
      <mesh><sphereGeometry args={[0.09, 12, 12]} /><meshStandardMaterial color="#9aafb2" metalness={0.75} /></mesh>
    </group>
    <pointLight position={[0, 0, -0.45]} color="#4cc8d6" intensity={0.8} distance={4} />
  </group>
}

function PowerSurge({ active }) {
  const light=useRef(),time=useRef(0),start=useRef(null),previous=useRef(active)
  useEffect(()=>{if(active&&!previous.current)start.current=time.current;previous.current=active},[active])
  useFrame(({clock})=>{
    time.current=clock.elapsedTime
    if(!light.current||start.current===null)return
    const elapsed=time.current-start.current
    if(elapsed>1.6){light.current.intensity=0;start.current=null;return}
    light.current.intensity=8*(1-elapsed/1.6)*(0.72+0.28*Math.sin(elapsed*20))
  })
  return <pointLight ref={light} position={[0,2.3,-6]} color="#f0ece0" intensity={0} distance={15} decay={1.7} />
}

function mazeNeighbours(cell) {
  const [c, r] = cell
  return [[c + 1,r],[c - 1,r],[c,r + 1],[c,r - 1]].filter(([nc,nr]) => nc >= 0 && nc < 5 && nr >= 0 && nr <= 10 && MAZE_OPEN_EDGES.has(mazeEdgeKey(cell,[nc,nr])))
}

function mazePath(start, end) {
  const queue = [[start]], visited = new Set([mazeCellKey(start)])
  while (queue.length) {
    const path = queue.shift(), last = path[path.length - 1]
    if (mazeCellKey(last) === mazeCellKey(end)) return path
    for (const next of mazeNeighbours(last)) {
      const key = mazeCellKey(next)
      if (!visited.has(key)) { visited.add(key); queue.push([...path, next]) }
    }
  }
  return [start, end]
}

function mazeGuidancePath(start, end) {
  const path = mazePath(start, end)
  if (path.length < 2) return []
  const guidance = [path[0]]
  for (let i = 1; i < path.length && i <= 3; i++) {
    guidance.push(path[i])
    // Stop at the next junction, before disclosing which branch to take there.
    if (i < path.length - 1 && mazeNeighbours(path[i]).length >= 3) break
  }
  return guidance
}

function SonarRing({ pulseId, position, delay }) {
  const mesh = useRef(), material = useRef(), start = useRef(null), lastId = useRef(pulseId)
  useFrame(({ clock }) => {
    if (lastId.current !== pulseId) { lastId.current = pulseId; start.current = clock.elapsedTime }
    if (start.current === null) start.current = clock.elapsedTime
    const t = clock.elapsedTime - start.current - delay
    if (!mesh.current || !material.current) return
    mesh.current.visible = t >= 0 && t < 1.35
    if (mesh.current.visible) {
      const scale = 0.3 + (t / 1.35) * 9
      mesh.current.scale.setScalar(scale)
      material.current.opacity = 0.48 * (1 - t / 1.35)
    }
  })
  return <mesh ref={mesh} position={[position[0], -0.07, position[1]]} rotation={[-Math.PI / 2, 0, 0]}>
    <ringGeometry args={[0.9, 1, 48]} /><meshBasicMaterial ref={material} color="#60e7f5" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
  </mesh>
}

function ScanPulse({ reveal }) {
  if (!reveal) return null
  return <group><SonarRing pulseId={reveal.id} position={reveal.position} delay={0} /><SonarRing pulseId={reveal.id} position={reveal.position} delay={0.22} /><SonarRing pulseId={reveal.id} position={reveal.position} delay={0.44} /></group>
}

function SonarGuideEdge({ pulseId, from, to }) {
  const lineMaterial = useRef(), tipMaterial = useRef(), start = useRef(null), lastId = useRef(pulseId)
  useFrame(({ clock }) => {
    if (lastId.current !== pulseId) { lastId.current = pulseId; start.current = clock.elapsedTime }
    if (start.current === null) start.current = clock.elapsedTime
    const elapsed = clock.elapsedTime - start.current
    const fade = elapsed < 1.9 ? 1 : THREE.MathUtils.clamp((2.7 - elapsed) / 0.8, 0, 1)
    if (lineMaterial.current) lineMaterial.current.opacity = 0.72 * fade
    if (tipMaterial.current) tipMaterial.current.opacity = 0.92 * fade
  })
  const [x,z] = mazeCellPosition(from), [nx,nz] = mazeCellPosition(to)
  const angle = Math.atan2(nx - x, nz - z)
  return <group position={[(x + nx) / 2, -0.083, (z + nz) / 2]} rotation={[0, angle, 0]}>
    <mesh><boxGeometry args={[0.11,0.018,2.8]} /><meshStandardMaterial ref={lineMaterial} color="#6ae8f1" emissive="#35d6ec" emissiveIntensity={2.1} transparent opacity={0.72} depthWrite={false} /></mesh>
    <mesh position={[0,0.008,1.2]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[0.13,0.27,3]} /><meshStandardMaterial ref={tipMaterial} color="#9af6fb" emissive="#35d6ec" emissiveIntensity={2.4} transparent opacity={0.92} depthWrite={false} /></mesh>
  </group>
}

function createRng(initialSeed) {
  let s = initialSeed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

function useMazeTextures() {
  const floorMap = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#949e9d'
    ctx.fillRect(0, 0, 512, 512)
    const tileSize = 64
    for (let x = 0; x < 512; x += tileSize) {
      for (let y = 0; y < 512; y += tileSize) {
        const shade = Math.floor(130 + ((x * 17 + y * 31) % 36))
        ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 3})`
        ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2)
        ctx.strokeStyle = '#55605f'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, tileSize, tileSize)
      }
    }
    const rand = createRng(49281)
    for (let i = 0; i < 40; i++) {
      const sx = rand() * 512, sy = rand() * 512, r = rand() * 45 + 10
      const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, r)
      grad.addColorStop(0, 'rgba(40, 50, 45, 0.35)')
      grad.addColorStop(1, 'rgba(40, 50, 45, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(25, 30, 28, 0.55)'
    ctx.lineWidth = 1.5
    for (let c = 0; c < 14; c++) {
      let cx = rand() * 512, cy = rand() * 512
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      for (let s = 0; s < 4; s++) {
        cx += (rand() - 0.5) * 35
        cy += (rand() - 0.5) * 35
        ctx.lineTo(cx, cy)
      }
      ctx.stroke()
    }
    const map = new THREE.CanvasTexture(canvas)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(10, 22)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  const wallMap = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#c0cac8'
    ctx.fillRect(0, 0, 512, 330)
    ctx.fillStyle = '#4a6358'
    ctx.fillRect(0, 330, 512, 182)
    ctx.fillStyle = '#283830'
    ctx.fillRect(0, 324, 512, 12)
    ctx.fillStyle = '#6b8a7f'
    ctx.fillRect(0, 322, 512, 2)
    ctx.fillStyle = '#1c2420'
    ctx.fillRect(0, 494, 512, 18)
    const rand = createRng(81734)
    for (let s = 0; s < 30; s++) {
      const wx = rand() * 512, ww = rand() * 20 + 6
      const grad = ctx.createLinearGradient(wx, 0, wx, 512)
      grad.addColorStop(0, 'rgba(20, 28, 24, 0.12)')
      grad.addColorStop(0.65, 'rgba(20, 28, 24, 0.22)')
      grad.addColorStop(1, 'rgba(10, 15, 12, 0.32)')
      ctx.fillStyle = grad
      ctx.fillRect(wx, 0, ww, 512)
    }
    const map = new THREE.CanvasTexture(canvas)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(2, 1)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  const ceilingMap = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#7a8688'
    ctx.fillRect(0, 0, 512, 512)
    for (let x = 0; x < 512; x += 128) {
      for (let y = 0; y < 512; y += 128) {
        ctx.fillStyle = '#9ea8a6'
        ctx.fillRect(x + 2, y + 2, 124, 124)
        ctx.strokeStyle = '#525e60'
        ctx.lineWidth = 4
        ctx.strokeRect(x, y, 128, 128)
      }
    }
    const rand = createRng(63821)
    for (let i = 0; i < 15; i++) {
      const cx = rand() * 512, cy = rand() * 512, r = rand() * 50 + 15
      ctx.fillStyle = 'rgba(60, 50, 32, 0.22)'
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    const map = new THREE.CanvasTexture(canvas)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(10, 22)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  return { floorMap, wallMap, ceilingMap }
}

function MazeFluorescent({ position, rotation = [0, 0, 0], flicker = false, seed = 0 }) {
  const lightRef = useRef(), tube1 = useRef(), tube2 = useRef()
  useFrame(({ clock }) => {
    if (!flicker) return
    const pulse = Math.sin(clock.elapsedTime * 23 + seed) > 0.92 ? 0.18 : 1
    if (lightRef.current) lightRef.current.intensity = 3.8 * pulse
    if (tube1.current) tube1.current.emissiveIntensity = 4.2 * pulse
    if (tube2.current) tube2.current.emissiveIntensity = 4.2 * pulse
  })
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.04, 0]} scale={[0.55, 0.08, 1.85]} color="#2a2e2c" metalness={0.8} />
    <mesh position={[-0.12, -0.01, 0]}>
      <boxGeometry args={[0.06, 0.025, 1.7]} />
      <meshStandardMaterial ref={tube1} color="#f8f4ec" emissive="#e8e2d0" emissiveIntensity={4.2} />
    </mesh>
    <mesh position={[0.12, -0.01, 0]}>
      <boxGeometry args={[0.06, 0.025, 1.7]} />
      <meshStandardMaterial ref={tube2} color="#f8f4ec" emissive="#e8e2d0" emissiveIntensity={4.2} />
    </mesh>
    <pointLight ref={lightRef} position={[0, -0.22, 0]} color="#ede8d8" intensity={3.8} distance={13} decay={1.2} />
  </group>
}

function MazeEmergencyBeacon({ position, rotation = [0, 0, 0] }) {
  const lamp = useRef()
  useFrame(({ clock }) => {
    if (lamp.current) lamp.current.intensity = 1.4 + Math.sin(clock.elapsedTime * 4.5 + position[2]) * 0.7
  })
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0, 0]} scale={[0.16, 0.28, 0.16]} color="#2c1a1a" metalness={0.8} />
    <mesh position={[0, 0, 0.1]}>
      <cylinderGeometry args={[0.065, 0.075, 0.18, 12]} />
      <meshStandardMaterial color="#ff2d20" emissive="#ff2010" emissiveIntensity={1.8} />
    </mesh>
    <pointLight ref={lamp} position={[0, 0, 0.28]} color="#ff2a1a" intensity={1.8} distance={7.5} decay={1.5} />
  </group>
}

function HospitalBed({ position, rotation = [0, 0, 0], tilted = false }) {
  return <group position={position} rotation={rotation}>
    {[[-0.45, -0.85], [0.45, -0.85], [-0.45, 0.85], [0.45, 0.85]].map(([x, z], i) => (
      <mesh key={i} position={[x, 0.08, z]}>
        <cylinderGeometry args={[0.06, 0.06, 0.04, 10]} />
        <meshStandardMaterial color="#1a2022" metalness={0.85} roughness={0.3} />
      </mesh>
    ))}
    <Box position={[0, 0.32, 0]} scale={[1.05, 0.08, 1.95]} color="#4a575c" metalness={0.8} roughness={0.35} />
    {[-0.85, 0.85].map((z) => (
      <Box key={z} position={[0, 0.2, z]} scale={[0.98, 0.24, 0.06]} color="#384348" metalness={0.8} />
    ))}
    <Box position={[0, 0.65, -0.96]} scale={[1.05, 0.58, 0.05]} color="#56666d" metalness={0.75} />
    <Box position={[0, 0.52, 0.96]} scale={[1.05, 0.35, 0.05]} color="#56666d" metalness={0.75} />
    <Box position={[0, 0.42, 0.1]} scale={[0.95, 0.14, 1.25]} color="#80918c" roughness={0.92} />
    <group position={[0, 0.42, -0.55]} rotation={[tilted ? -0.38 : -0.12, 0, 0]}>
      <Box position={[0, 0, -0.25]} scale={[0.95, 0.14, 0.62]} color="#889893" roughness={0.92} />
      <Box position={[0, 0.1, -0.38]} scale={[0.65, 0.08, 0.32]} color="#cfd8d6" roughness={0.95} />
    </group>
    <mesh position={[0.54, 0.95, -0.85]}>
      <cylinderGeometry args={[0.016, 0.016, 1.45, 8]} />
      <meshStandardMaterial color="#8a9ba0" metalness={0.9} roughness={0.2} />
    </mesh>
    <mesh position={[0.54, 1.62, -0.85]}>
      <torusGeometry args={[0.08, 0.012, 6, 12]} />
      <meshStandardMaterial color="#8a9ba0" metalness={0.9} />
    </mesh>
    <Box position={[0.54, 1.48, -0.85]} scale={[0.1, 0.18, 0.04]} color="#d6f4f8" transparent opacity={0.72} roughness={0.15} />
  </group>
}

function Wheelchair({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    {[-0.34, 0.34].map((x) => (
      <group key={x} position={[x, 0.34, -0.05]}>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.32, 0.022, 8, 24]} />
          <meshStandardMaterial color="#72848a" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.03, 10]} />
          <meshStandardMaterial color="#1f272a" metalness={0.8} />
        </mesh>
      </group>
    ))}
    {[-0.26, 0.26].map((x) => (
      <mesh key={x} position={[x, 0.09, 0.35]}>
        <cylinderGeometry args={[0.07, 0.07, 0.035, 10]} />
        <meshStandardMaterial color="#1a2022" metalness={0.8} />
      </mesh>
    ))}
    <Box position={[0, 0.28, 0.1]} scale={[0.56, 0.04, 0.58]} color="#38454a" metalness={0.85} />
    <Box position={[0, 0.58, -0.22]} scale={[0.54, 0.55, 0.04]} color="#243330" roughness={0.78} />
    <Box position={[0, 0.32, 0.06]} scale={[0.54, 0.05, 0.48]} color="#243330" roughness={0.78} />
    {[-0.28, 0.28].map((x) => (
      <Box key={x} position={[x, 0.52, 0.02]} scale={[0.05, 0.04, 0.42]} color="#141c1b" roughness={0.5} />
    ))}
    <Box position={[0, 0.12, 0.42]} scale={[0.48, 0.02, 0.18]} color="#56676d" metalness={0.8} />
  </group>
}

function MedicalCrashCart({ position, rotation = [0, 0, 0], screenColor = '#43e292' }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.08, 0]} scale={[0.62, 0.05, 0.52]} color="#1a2326" metalness={0.85} />
    {[-0.26, 0.26].map((x) => (
      <Box key={x} position={[x, 0.52, 0]} scale={[0.04, 0.88, 0.04]} color="#506167" metalness={0.8} />
    ))}
    <Box position={[0, 0.35, 0]} scale={[0.56, 0.32, 0.46]} color="#2e4242" metalness={0.65} roughness={0.4} />
    <Box position={[0, 0.65, 0]} scale={[0.62, 0.04, 0.52]} color="#485c5c" metalness={0.75} />
    <Box position={[0, 0.88, -0.05]} scale={[0.42, 0.34, 0.28]} color="#1b2427" metalness={0.85} />
    <mesh position={[0, 0.88, 0.095]}>
      <planeGeometry args={[0.34, 0.24]} />
      <meshBasicMaterial color="#061812" />
    </mesh>
    {[-0.06, 0, 0.06].map((y, i) => (
      <mesh key={i} position={[0, 0.88 + y, 0.098]}>
        <planeGeometry args={[0.28, 0.012]} />
        <meshBasicMaterial color={screenColor} />
      </mesh>
    ))}
    <mesh position={[0.22, 0.72, 0.1]} rotation={[0.4, 0.2, 0]}>
      <torusGeometry args={[0.14, 0.018, 6, 16, Math.PI]} />
      <meshStandardMaterial color="#8ab8bc" roughness={0.6} />
    </mesh>
    <pointLight position={[0, 0.95, 0.25]} color={screenColor} intensity={0.55} distance={2.5} />
  </group>
}

function ChemicalCabinet({ position, rotation = [0, 0, 0], glowColor = '#32e88a' }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 1.25, 0]} scale={[1.35, 2.45, 0.58]} color="#1e2d30" metalness={0.78} roughness={0.35} />
    <Box position={[0, 1.25, 0.03]} scale={[1.22, 2.32, 0.48]} color="#0c1719" metalness={0.85} />
    {[0.65, 1.25, 1.85].map((y) => (
      <Box key={y} position={[0, y, 0]} scale={[1.2, 0.035, 0.46]} color="#3e5257" metalness={0.8} />
    ))}
    {[-0.42, -0.15, 0.15, 0.42].map((x, i) => (
      <group key={i} position={[x, 0.82, 0]}>
        <mesh>
          <cylinderGeometry args={[0.075, 0.075, 0.28, 12]} />
          <meshStandardMaterial color="#1a3532" metalness={0.4} roughness={0.1} transparent opacity={0.65} />
        </mesh>
        <mesh position={[0, -0.03, 0]}>
          <cylinderGeometry args={[0.065, 0.065, 0.2, 10]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={2.2} />
        </mesh>
      </group>
    ))}
    {[-0.35, 0, 0.35].map((x, i) => (
      <group key={i} position={[x, 1.42, 0]}>
        <mesh>
          <cylinderGeometry args={[0.09, 0.09, 0.32, 12]} />
          <meshStandardMaterial color="#2a321a" metalness={0.4} roughness={0.1} transparent opacity={0.65} />
        </mesh>
        <mesh position={[0, -0.04, 0]}>
          <cylinderGeometry args={[0.078, 0.078, 0.22, 10]} />
          <meshStandardMaterial color={i === 1 ? '#e88a32' : glowColor} emissive={i === 1 ? '#e88a32' : glowColor} emissiveIntensity={2.2} />
        </mesh>
      </group>
    ))}
    {[-0.31, 0.31].map((x) => (
      <mesh key={x} position={[x, 1.25, 0.28]}>
        <boxGeometry args={[0.58, 2.3, 0.02]} />
        <meshStandardMaterial color="#72b8bf" roughness={0.15} metalness={0.2} transparent opacity={0.38} />
      </mesh>
    ))}
    <pointLight position={[0, 1.25, 0.32]} color={glowColor} intensity={1.4} distance={4.5} decay={1.6} />
  </group>
}

function LabBench({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.42, 0]} scale={[1.8, 0.82, 0.85]} color="#243033" metalness={0.7} />
    <Box position={[0, 0.85, 0]} scale={[1.9, 0.06, 0.95]} color="#141c1e" metalness={0.4} roughness={0.3} />
    <Box position={[0, 1.28, -0.32]} scale={[1.8, 0.04, 0.28]} color="#38494d" metalness={0.75} />
    <Box position={[-0.85, 1.05, -0.32]} scale={[0.04, 0.42, 0.24]} color="#38494d" metalness={0.75} />
    <Box position={[0.85, 1.05, -0.32]} scale={[0.04, 0.42, 0.24]} color="#38494d" metalness={0.75} />
    <mesh position={[-0.45, 0.98, 0]}>
      <cylinderGeometry args={[0.14, 0.16, 0.18, 14]} />
      <meshStandardMaterial color="#687c82" metalness={0.82} />
    </mesh>
    {[-0.1, 0.1, 0.3].map((x, i) => (
      <mesh key={i} position={[x, 1.38, -0.3]}>
        <cylinderGeometry args={[0.04, 0.055, 0.16, 8]} />
        <meshStandardMaterial color={i === 0 ? '#38d2e8' : i === 1 ? '#34e88f' : '#e08a3c'} emissive={i === 0 ? '#38d2e8' : i === 1 ? '#34e88f' : '#e08a3c'} emissiveIntensity={1.5} />
      </mesh>
    ))}
    <group position={[0.7, 0.18, 0.7]} rotation={[1.35, 0.4, 0.8]}>
      <mesh position={[0, 0.28, 0]}><cylinderGeometry args={[0.18, 0.18, 0.04, 12]} /><meshStandardMaterial color="#42555a" metalness={0.8} /></mesh>
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((r) => (
        <mesh key={r} position={[Math.cos(r) * 0.12, 0.14, Math.sin(r) * 0.12]}><cylinderGeometry args={[0.015, 0.015, 0.28, 6]} /><meshStandardMaterial color="#63767c" metalness={0.85} /></mesh>
      ))}
    </group>
  </group>
}

function HazardBarrel({ position, color = '#2e453e' }) {
  return <group position={position}>
    <mesh position={[0, 0.45, 0]}>
      <cylinderGeometry args={[0.3, 0.3, 0.88, 14]} />
      <meshStandardMaterial color={color} metalness={0.65} roughness={0.42} />
    </mesh>
    {[-0.22, 0, 0.22].map((y) => (
      <mesh key={y} position={[0, 0.45 + y, 0]}>
        <torusGeometry args={[0.305, 0.014, 6, 16]} />
        <meshStandardMaterial color="#1a2422" metalness={0.8} />
      </mesh>
    ))}
    <mesh position={[0, 0.45, 0]}>
      <cylinderGeometry args={[0.302, 0.302, 0.14, 14]} />
      <meshStandardMaterial color="#d4a337" metalness={0.4} roughness={0.6} />
    </mesh>
  </group>
}

function HospitalWallSign({ position, rotation = [0, 0, 0], text, code, color = '#57c7d4' }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0, 0]} scale={[1.25, 0.38, 0.025]} color="#121d20" metalness={0.8} />
    <Box position={[0, 0.14, 0.015]} scale={[1.2, 0.035, 0.01]} color={color} />
    <Text position={[0, 0.02, 0.02]} fontSize={0.075} color="#e5eff0" anchorX="center">
      {text}
    </Text>
    <Text position={[0, -0.1, 0.02]} fontSize={0.048} color={color} anchorX="center">
      {code}
    </Text>
  </group>
}

function WaterPuddle({ position, scale = [1.2, 0.8] }) {
  return <mesh position={[position[0], -0.11, position[1]]} rotation={[-Math.PI / 2, 0, 0]} scale={[scale[0], scale[1], 1]}>
    <circleGeometry args={[1, 24]} />
    <meshStandardMaterial color="#111410" roughness={0.05} metalness={0.82} transparent opacity={0.80} depthWrite={false} />
  </mesh>
}

function OverheadVentDuct({ position, rotation = [0, 0, 0], length = 8 }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0, 0]} scale={[0.75, 0.4, length]} color="#3a484d" metalness={0.82} roughness={0.35} />
    {Array.from({ length: Math.floor(length / 2) + 1 }, (_, i) => -length / 2 + i * 2).map((z) => (
      <Box key={z} position={[0, 0, z]} scale={[0.82, 0.45, 0.06]} color="#232e32" metalness={0.9} />
    ))}
  </group>
}

function WallPipes({ position, rotation = [0, 0, 0], length = 8 }) {
  return <group position={position} rotation={rotation}>
    <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.042, 0.042, length, 8]} />
      <meshStandardMaterial color="#366b5b" metalness={0.7} roughness={0.35} />
    </mesh>
    <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.035, 0.035, length, 8]} />
      <meshStandardMaterial color="#7a342e" metalness={0.7} roughness={0.35} />
    </mesh>
    <mesh position={[0, -0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.048, 0.048, length, 8]} />
      <meshStandardMaterial color="#435257" metalness={0.85} roughness={0.25} />
    </mesh>
  </group>
}

function HangingCables({ position }) {
  return <group position={position}>
    <mesh position={[-0.1, -0.45, 0]} rotation={[0.1, 0, 0.15]}>
      <cylinderGeometry args={[0.012, 0.012, 0.9, 6]} />
      <meshStandardMaterial color="#1a2224" metalness={0.6} />
    </mesh>
    <mesh position={[0.08, -0.55, 0.05]} rotation={[-0.15, 0, -0.12]}>
      <cylinderGeometry args={[0.014, 0.014, 1.1, 6]} />
      <meshStandardMaterial color="#32221e" metalness={0.5} />
    </mesh>
  </group>
}

function FloorPapers({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    {[-0.15, 0.12, 0].map((x, i) => (
      <mesh key={i} position={[x, -0.115, (i - 1) * 0.14]} rotation={[-Math.PI / 2, 0, i * 0.7]}>
        <planeGeometry args={[0.22, 0.3]} />
        <meshStandardMaterial color={i === 1 ? '#d8ceb8' : '#e6dfd1'} roughness={0.9} />
      </mesh>
    ))}
  </group>
}

function SkeletonProp({ position, rotation = [0, 0, 0], slumped = true }) {
  return <group position={position} rotation={rotation}>
    <mesh position={[0, slumped ? 0.38 : 0.08, slumped ? -0.05 : 0]}>
      <sphereGeometry args={[0.088, 10, 8]} />
      <meshStandardMaterial color="#c5b9a5" roughness={0.88} />
    </mesh>
    {[-0.026, 0.026].map((x) => (
      <mesh key={x} position={[x, (slumped ? 0.38 : 0.08) + 0.01, (slumped ? -0.05 : 0) + 0.075]}>
        <sphereGeometry args={[0.018, 6, 6]} />
        <meshBasicMaterial color="#14110c" />
      </mesh>
    ))}
    <Box position={[0, slumped ? 0.22 : 0.06, slumped ? 0 : -0.22]} scale={[0.19, 0.2, 0.13]} color="#baa994" roughness={0.88} />
    <Box position={[0, slumped ? 0.08 : 0.05, slumped ? 0.04 : -0.38]} scale={[0.16, 0.09, 0.12]} color="#b2a18c" roughness={0.88} />
    <mesh position={[-0.14, slumped ? 0.16 : 0.04, slumped ? 0.08 : -0.16]} rotation={[0.4, 0, 0.3]}>
      <cylinderGeometry args={[0.014, 0.014, 0.26, 5]} />
      <meshStandardMaterial color="#b8aa97" roughness={0.88} />
    </mesh>
    <mesh position={[0.14, slumped ? 0.16 : 0.04, slumped ? 0.08 : -0.16]} rotation={[0.4, 0, -0.3]}>
      <cylinderGeometry args={[0.014, 0.014, 0.26, 5]} />
      <meshStandardMaterial color="#b8aa97" roughness={0.88} />
    </mesh>
    <mesh position={[-0.08, 0.04, slumped ? 0.24 : -0.58]} rotation={[slumped ? 1.2 : 0, 0, 0.15]}>
      <cylinderGeometry args={[0.016, 0.016, 0.34, 5]} />
      <meshStandardMaterial color="#b2a18c" roughness={0.88} />
    </mesh>
    <mesh position={[0.08, 0.04, slumped ? 0.24 : -0.58]} rotation={[slumped ? 1.2 : 0, 0, -0.15]}>
      <cylinderGeometry args={[0.016, 0.016, 0.34, 5]} />
      <meshStandardMaterial color="#b2a18c" roughness={0.88} />
    </mesh>
  </group>
}

function CoveredBody({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.28, 0]} scale={[0.82, 0.06, 1.95]} color="#364347" metalness={0.82} />
    {[[-0.36, -0.85], [0.36, -0.85], [-0.36, 0.85], [0.36, 0.85]].map(([x, z], i) => (
      <mesh key={i} position={[x, 0.07, z]}>
        <cylinderGeometry args={[0.055, 0.055, 0.04, 8]} />
        <meshStandardMaterial color="#1a2022" metalness={0.8} />
      </mesh>
    ))}
    <Box position={[0, 0.38, 0]} scale={[0.66, 0.16, 1.82]} color="#73827d" roughness={0.94} />
    <mesh position={[0, 0.47, -0.68]}>
      <sphereGeometry args={[0.13, 10, 8]} />
      <meshStandardMaterial color="#6f7e79" roughness={0.94} />
    </mesh>
    <mesh position={[0, 0.49, -0.15]}>
      <cylinderGeometry args={[0.26, 0.29, 0.65, 8]} />
      <meshStandardMaterial color="#6a7a75" roughness={0.94} />
    </mesh>
    <Box position={[0, 0.44, 0.72]} scale={[0.34, 0.12, 0.22]} color="#6a7a75" roughness={0.94} />
    {[-0.32, 0.25].map((z) => (
      <Box key={z} position={[0, 0.48, z]} scale={[0.69, 0.025, 0.055]} color="#242c2a" roughness={0.8} />
    ))}
  </group>
}

function BloodDecayStain({ position, scale = [1.2, 0.9], rotation = 0 }) {
  return <mesh position={[position[0], -0.11, position[1]]} rotation={[-Math.PI / 2, 0, rotation]} scale={[scale[0], scale[1], 1]}>
    <circleGeometry args={[1, 16]} />
    <meshStandardMaterial color="#2d0808" roughness={0.32} metalness={0.12} transparent opacity={0.78} depthWrite={false} />
  </mesh>
}

function DamagedVentilator({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.55, 0]} scale={[0.54, 1.05, 0.48]} color="#2c3c40" metalness={0.75} roughness={0.35} />
    <mesh position={[0, 0.88, 0.25]}>
      <planeGeometry args={[0.38, 0.28]} />
      <meshBasicMaterial color="#081412" />
    </mesh>
    <mesh position={[0, 0.88, 0.255]} rotation={[0, 0, 0.65]}>
      <planeGeometry args={[0.35, 0.01]} />
      <meshBasicMaterial color="#33524c" />
    </mesh>
    {[-0.12, 0.12].map((x) => (
      <mesh key={x} position={[x, 0.58, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.02, 12]} />
        <meshStandardMaterial color="#889da2" metalness={0.8} />
      </mesh>
    ))}
    <mesh position={[0.18, 0.38, 0.26]} rotation={[0.4, 0.2, 0]}>
      <torusGeometry args={[0.14, 0.02, 6, 16, Math.PI * 0.9]} />
      <meshStandardMaterial color="#7a9ea2" roughness={0.5} />
    </mesh>
    <pointLight position={[0, 0.88, 0.32]} color="#42d488" intensity={0.25} distance={2} />
  </group>
}

function ResearchDesk({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    <Box position={[0, 0.4, 0]} scale={[1.65, 0.78, 0.8]} color="#283538" metalness={0.7} />
    <Box position={[0, 0.81, 0]} scale={[1.75, 0.05, 0.9]} color="#161e20" metalness={0.4} roughness={0.3} />
    <mesh position={[-0.45, 0.95, 0]}>
      <cylinderGeometry args={[0.07, 0.09, 0.22, 10]} />
      <meshStandardMaterial color="#4a5e63" metalness={0.85} />
    </mesh>
    <Box position={[0.25, 0.87, -0.15]} scale={[0.42, 0.08, 0.16]} color="#38494d" metalness={0.8} />
    {[-0.12, 0, 0.12].map((x, i) => (
      <mesh key={i} position={[0.25 + x, 0.96, -0.15]}>
        <cylinderGeometry args={[0.022, 0.022, 0.16, 8]} />
        <meshStandardMaterial color={i === 0 ? '#34e88f' : i === 1 ? '#e88a32' : '#b243e8'} emissive={i === 0 ? '#34e88f' : i === 1 ? '#e88a32' : '#b243e8'} emissiveIntensity={2.2} />
      </mesh>
    ))}
    <mesh position={[-0.1, 0.84, 0.15]} rotation={[-Math.PI / 2, 0, 0.35]}>
      <planeGeometry args={[0.2, 0.28]} />
      <meshStandardMaterial color="#ded7c6" roughness={0.9} />
    </mesh>
    <pointLight position={[0.25, 1.05, -0.15]} color="#38e88f" intensity={0.65} distance={2.5} />
  </group>
}

function OverturnedFurniture({ position, rotation = [0, 0, 0] }) {
  return <group position={position} rotation={rotation}>
    <group position={[0, 0.25, 0]} rotation={[0.2, 0.1, 1.52]}>
      <Box position={[0, 0, 0]} scale={[0.55, 0.72, 0.48]} color="#3c4c50" metalness={0.7} />
      <Box position={[0.15, 0.18, 0.12]} scale={[0.45, 0.18, 0.38]} color="#2c3a3e" metalness={0.6} />
    </group>
    <mesh position={[0.45, 0.04, 0.35]} rotation={[0, 0.4, Math.PI / 2 - 0.05]}>
      <cylinderGeometry args={[0.015, 0.015, 1.5, 6]} />
      <meshStandardMaterial color="#7a8c91" metalness={0.88} />
    </mesh>
  </group>
}

function ExtrudedGunProfile({ points, depth, position = [0, 0, 0], color, metalness = 0.5, roughness = 0.5 }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    points.forEach(([z, y], index) => index === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y))
    shape.closePath()
    const mesh = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.004, bevelThickness: 0.004, curveSegments: 8 })
    mesh.rotateY(Math.PI / 2)
    mesh.computeVertexNormals()
    return mesh
  }, [points, depth])
  return <mesh geometry={geometry} position={[position[0] - depth / 2, position[1], position[2]]} castShadow receiveShadow>
    <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
  </mesh>
}

function DetailedHandgun({ muzzleRef }) {
  const metal = '#303536', edge = '#737a78', polymer = '#171c1b'
  return <group>
    {/* A continuous, beveled side profile gives the slide and frame a proper pistol silhouette. */}
    <ExtrudedGunProfile depth={0.125} color={metal} metalness={0.86} roughness={0.27}
      points={[[-0.25,0.025],[-0.25,0.083],[-0.232,0.104],[-0.205,0.11],[-0.045,0.11],[-0.018,0.094],[0.01,0.074],[0.055,0.064],[0.09,0.035],[0.09,-0.014],[0.04,-0.026],[0.015,0.018],[-0.035,0.035]]} />
    <ExtrudedGunProfile depth={0.112} position={[0,-0.003,0]} color={polymer} metalness={0.24} roughness={0.72}
      points={[[-0.04,0.038],[0.025,0.036],[0.07,0.015],[0.078,-0.012],[0.053,-0.025],[0.025,-0.01],[-0.005,-0.004],[-0.015,-0.075],[0.014,-0.176],[-0.004,-0.188],[-0.085,-0.166],[-0.122,-0.047]]} />
    {/* Slide rails and barrel crown */}
    <mesh position={[0,0.047,-0.158]} castShadow><boxGeometry args={[0.108,0.046,0.18]} /><meshStandardMaterial color="#454a49" metalness={0.92} roughness={0.22} /></mesh>
    <mesh position={[0,0.015,-0.242]} rotation={[-Math.PI/2,0,0]}><cylinderGeometry args={[0.022,0.022,0.105,24]} /><meshStandardMaterial color="#111515" metalness={0.94} roughness={0.2} /></mesh>
    <mesh position={[0,0.015,-0.228]} rotation={[-Math.PI/2,0,0]}><cylinderGeometry args={[0.027,0.027,0.014,24]} /><meshStandardMaterial color={edge} metalness={0.9} roughness={0.24} /></mesh>
    <mesh position={[0,0.015,-0.236]} rotation={[-Math.PI/2,0,0]}><cylinderGeometry args={[0.014,0.014,0.003,20]} /><meshStandardMaterial color="#050707" metalness={0.6} roughness={0.2} /></mesh>
    {/* Ejection port, extractor, controls and wear lines */}
    <mesh position={[0.064,0.058,-0.092]}><boxGeometry args={[0.003,0.019,0.054]} /><meshStandardMaterial color="#111515" metalness={0.8} roughness={0.35} /></mesh>
    <mesh position={[0.066,0.058,-0.092]}><boxGeometry args={[0.002,0.006,0.033]} /><meshStandardMaterial color="#9a9b91" metalness={0.9} roughness={0.3} /></mesh>
    {[-0.205,-0.194,-0.183,-0.172,-0.161,-0.15].map((z)=><mesh key={z} position={[0.065,0.052,z]}><boxGeometry args={[0.004,0.041,0.004]} /><meshStandardMaterial color="#171b1b" metalness={0.72} roughness={0.48} /></mesh>)}
    {[-0.133,0.025].map((z)=><mesh key={z} position={[0.067,0.02,z]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.007,0.007,0.007,12]} /><meshStandardMaterial color="#989a92" metalness={0.9} roughness={0.27} /></mesh>)}
    <mesh position={[0,0.113,-0.052]}><boxGeometry args={[0.025,0.012,0.038]} /><meshStandardMaterial color="#111515" metalness={0.8} roughness={0.34} /></mesh>
    <mesh position={[0,0.113,-0.209]}><boxGeometry args={[0.031,0.012,0.024]} /><meshStandardMaterial color="#3f4544" metalness={0.86} roughness={0.27} /></mesh>
    {/* Grip panels, molded checkering, trigger and magazine floor plate */}
    <mesh position={[0.058,-0.095,0.053]} rotation={[0,0,-0.12]}><boxGeometry args={[0.006,0.132,0.095]} /><meshStandardMaterial color="#242a27" roughness={0.85} /></mesh>
    {Array.from({length:9},(_,i)=><mesh key={i} position={[0.062,-0.151+i*0.014,0.053]} rotation={[0,0,-0.12]}><boxGeometry args={[0.008,0.0025,0.087]} /><meshStandardMaterial color="#454c46" roughness={0.9} /></mesh>)}
    <mesh position={[0,-0.183,0.053]} rotation={[0,0,-0.12]}><boxGeometry args={[0.112,0.014,0.102]} /><meshStandardMaterial color="#363c38" metalness={0.38} roughness={0.58} /></mesh>
    <mesh position={[0,-0.071,0.105]} rotation={[0,0,0.12]}><torusGeometry args={[0.04,0.0045,8,24,Math.PI]} /><meshStandardMaterial color="#858b86" metalness={0.83} roughness={0.32} /></mesh>
    <mesh position={[0,-0.067,0.105]} rotation={[0,0,0.12]}><capsuleGeometry args={[0.005,0.033,4,8]} /><meshStandardMaterial color="#b0aa9e" metalness={0.68} roughness={0.38} /></mesh>
    <mesh ref={muzzleRef} position={[0,0.015,-0.31]} rotation={[-Math.PI/2,0,0]} visible={false}><coneGeometry args={[0.05,0.19,8]} /><meshBasicMaterial color="#ffc56e" transparent opacity={0.9} depthWrite={false} /></mesh>
  </group>
}

function HandgunModel({ muzzleRef, firstPerson = false }) {
  if (firstPerson) return <DetailedHandgun muzzleRef={muzzleRef} />
  return <group>
    <mesh position={[0, 0.015, -0.055]} castShadow><boxGeometry args={[0.14, 0.105, 0.31]} /><meshStandardMaterial color="#373c3c" metalness={0.84} roughness={0.3} /></mesh>
    <mesh position={[0, 0.071, -0.065]} castShadow><boxGeometry args={[0.12, 0.055, 0.27]} /><meshStandardMaterial color="#676b68" metalness={0.88} roughness={0.25} /></mesh>
    <mesh position={[0, 0.012, -0.235]} rotation={[-Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.027, 0.027, 0.09, 12]} /><meshStandardMaterial color="#15191a" metalness={0.92} roughness={0.24} /></mesh>
    <mesh position={[0, 0.012, -0.19]} rotation={[-Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.031, 0.031, 0.014, 12]} /><meshStandardMaterial color="#777a74" metalness={0.9} roughness={0.27} /></mesh>
    <mesh position={[0, -0.092, 0.055]} rotation={[0, 0, -0.12]} castShadow><boxGeometry args={[0.105, 0.19, 0.13]} /><meshStandardMaterial color="#252a29" metalness={0.28} roughness={0.82} /></mesh>
    <mesh position={[0.055, -0.095, 0.055]} castShadow><boxGeometry args={[0.008, 0.135, 0.105]} /><meshStandardMaterial color="#303632" metalness={0.18} roughness={0.92} /></mesh>
    {[-0.145, -0.126, -0.107, -0.088, -0.069, -0.05].map((y) => <mesh key={y} position={[0.06, y, 0.055]} rotation={[0, 0, -0.12]}>
      <boxGeometry args={[0.004, 0.005, 0.092]} /><meshStandardMaterial color="#697067" metalness={0.12} roughness={0.95} />
    </mesh>)}
    <mesh position={[0, -0.075, 0.12]} rotation={[0, 0, 0.12]}><torusGeometry args={[0.043, 0.008, 6, 16, Math.PI]} /><meshStandardMaterial color="#85877e" metalness={0.76} roughness={0.34} /></mesh>
    <mesh position={[0, -0.068, 0.105]} rotation={[0, 0, 0.12]}><capsuleGeometry args={[0.006, 0.035, 3, 6]} /><meshStandardMaterial color="#b0a99a" metalness={0.72} roughness={0.36} /></mesh>
    <mesh position={[0.071, 0.064, -0.045]}><boxGeometry args={[0.004, 0.021, 0.071]} /><meshStandardMaterial color="#191d1c" metalness={0.46} roughness={0.62} /></mesh>
    <mesh position={[0.073, 0.064, -0.045]}><boxGeometry args={[0.003, 0.025, 0.078]} /><meshStandardMaterial color="#777b75" metalness={0.82} roughness={0.31} /></mesh>
    {[-0.115, -0.092, -0.069, -0.046].map((z) => <mesh key={z} position={[0.062, 0.056, z]}>
      <boxGeometry args={[0.004, 0.048, 0.008]} /><meshStandardMaterial color="#292e2d" metalness={0.5} roughness={0.48} />
    </mesh>)}
    {[-0.13, 0.03].map((z) => <mesh key={z} position={[0.073, 0.018, z]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.008, 0.008, 0.006, 10]} /><meshStandardMaterial color="#99978d" metalness={0.9} roughness={0.28} />
    </mesh>)}
    <mesh position={[0, 0.132, -0.035]}><boxGeometry args={[0.025, 0.015, 0.04]} /><meshStandardMaterial color="#191d1d" metalness={0.76} /></mesh>
    <mesh position={[0, 0.133, -0.19]}><boxGeometry args={[0.035, 0.014, 0.026]} /><meshStandardMaterial color="#343a39" metalness={0.82} roughness={0.31} /></mesh>
    <mesh position={[0, 0.133, 0.073]}><boxGeometry args={[0.035, 0.014, 0.026]} /><meshStandardMaterial color="#343a39" metalness={0.82} roughness={0.31} /></mesh>
    <mesh position={[0.062, 0.095, -0.13]} rotation={[0, 0, -0.1]}><boxGeometry args={[0.002, 0.003, 0.045]} /><meshStandardMaterial color="#b2aaa0" metalness={0.72} roughness={0.42} /></mesh>
    <mesh position={[0.062, 0.078, 0.01]} rotation={[0, 0, 0.12]}><boxGeometry args={[0.002, 0.002, 0.026]} /><meshStandardMaterial color="#aaa398" metalness={0.68} roughness={0.46} /></mesh>
    <mesh ref={muzzleRef} position={[0, 0.015, -0.31]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <coneGeometry args={[0.05, 0.19, 7]} /><meshBasicMaterial color="#ffc56e" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  </group>
}

function HandgunPickup({ position }) {
  return <group position={position} rotation={[0.08, -0.5, -0.12]} scale={0.78}>
    <HandgunModel />
  </group>
}

const MemoizedHandgunPickup = memo(HandgunPickup)

function GrippingFinger({ points, radius = 0.011, color = '#81786b' }) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)))
    const longitudinalSegments = 24, radialSegments = 12
    const frames = curve.computeFrenetFrames(longitudinalSegments, false)
    const positions = [], uvs = [], indices = []
    for (let i = 0; i <= longitudinalSegments; i++) {
      const t = i / longitudinalSegments
      const center = curve.getPointAt(t)
      const taper = 0.72 + Math.sin(Math.PI * t) * 0.28
      for (let j = 0; j <= radialSegments; j++) {
        const angle = j / radialSegments * Math.PI * 2
        const normal = frames.normals[i].clone().multiplyScalar(Math.cos(angle))
        const binormal = frames.binormals[i].clone().multiplyScalar(Math.sin(angle))
        const vertex = center.clone().addScaledVector(normal, radius * taper).addScaledVector(binormal, radius * taper * 0.88)
        positions.push(vertex.x, vertex.y, vertex.z)
        uvs.push(j / radialSegments, t)
        if (i < longitudinalSegments && j < radialSegments) {
          const a = i * (radialSegments + 1) + j, b = a + radialSegments + 1
          indices.push(a, b, a + 1, b, b + 1, a + 1)
        }
      }
    }
    const tube = new THREE.BufferGeometry()
    tube.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    tube.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    tube.setIndex(indices)
    tube.computeVertexNormals()
    return tube
  }, [points, radius])
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={color} roughness={0.78} /></mesh>
}

function HandgunHand() {
  const palmGeometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(-0.008,-0.153); shape.quadraticCurveTo(-0.031,-0.126,-0.026,-0.09)
    shape.lineTo(-0.022,-0.035); shape.quadraticCurveTo(-0.017,-0.012,0.005,-0.014)
    shape.lineTo(0.073,-0.022); shape.quadraticCurveTo(0.096,-0.025,0.097,-0.052)
    shape.lineTo(0.09,-0.136); shape.quadraticCurveTo(0.084,-0.165,0.06,-0.174)
    shape.lineTo(0.019,-0.178); shape.quadraticCurveTo(-0.001,-0.177,-0.008,-0.153)
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.038, bevelEnabled: true, bevelSegments: 5, steps: 1, bevelSize: 0.009, bevelThickness: 0.01, curveSegments: 12 })
    geometry.translate(0, 0, -0.023)
    return geometry
  }, [])
  const fingers = [
    [[0.01,-0.045,0.167],[-0.012,-0.048,0.159],[-0.033,-0.057,0.145],[-0.029,-0.068,0.13]],
    [[0.023,-0.074,0.17],[0.004,-0.078,0.163],[-0.026,-0.087,0.142],[-0.023,-0.099,0.108]],
    [[0.028,-0.105,0.168],[0.008,-0.109,0.16],[-0.021,-0.118,0.14],[-0.018,-0.13,0.108]],
    [[0.03,-0.136,0.162],[0.013,-0.14,0.155],[-0.012,-0.15,0.137],[-0.006,-0.16,0.11]],
  ]
  return <group>
    {/* Sleeve, cuff and tapered wrist lead naturally into the palm. */}
    <mesh position={[0.086,-0.242,0.17]} rotation={[0.12,0,-0.19]} castShadow>
      <capsuleGeometry args={[0.034,0.19,8,16]} /><meshStandardMaterial color="#343b36" roughness={0.92} />
    </mesh>
    <mesh position={[0.071,-0.18,0.16]} rotation={[0,0,-0.18]} castShadow>
      <capsuleGeometry args={[0.027,0.064,6,14]} /><meshStandardMaterial color="#8a7e6e" roughness={0.82} />
    </mesh>
    <mesh position={[0.076,-0.199,0.166]} rotation={[0,0,-0.18]} castShadow>
      <torusGeometry args={[0.029,0.004,8,20]} /><meshStandardMaterial color="#4c5148" roughness={0.88} />
    </mesh>
    <mesh geometry={palmGeometry} position={[0.012,-0.008,0.144]} castShadow receiveShadow>
      <meshStandardMaterial color="#81786b" roughness={0.78} />
    </mesh>
    {/* Four curled, jointed fingers wrap over the grip; the thumb braces its side. */}
    {fingers.map((points,index)=><GrippingFinger key={index} points={points} radius={index===3?0.009:0.011} color={index%2?'#83796d':'#918575'} />)}
    <GrippingFinger points={[[0.045,-0.045,0.162],[0.018,-0.03,0.15],[-0.014,-0.036,0.125],[-0.028,-0.054,0.096]]} radius={0.011} color="#918575" />
  </group>
}

function MazeLevel({ reveal, mazeExited, handgunCollected }) {
  const { floorMap, wallMap, ceilingMap } = useMazeTextures()
  const staticMaze = useMemo(() => {
    const wallMaterial = <meshStandardMaterial map={wallMap} roughness={0.82} metalness={0.15} />
    return <group>
    {/* Global Maze Ambient & Directional Fill - Warm neutral white, clearly visible */}
    <ambientLight intensity={1.05} color="#e4dece" />
    <directionalLight position={[0, 18, -49]} intensity={0.85} color="#e8e0d0" />

    {/* Terrazzo / Tile Hospital Floor - Fixed horizontal orientation, solid and bright */}
    <mesh position={[0, -0.12, -49]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[20.5, 44.5]} />
      <meshStandardMaterial map={floorMap} roughness={0.68} metalness={0.12} color="#f0ede6" />
    </mesh>

    {/* Suspended Hospital Acoustic Ceiling */}
    <mesh position={[0, 3.6, -49]} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[20.5, 44.5]} />
      <meshStandardMaterial map={ceilingMap} roughness={0.88} metalness={0.08} color="#d8d4cc" />
    </mesh>

    {/* Maze Walls with Hospital Two-Tone Material */}
    {MAZE_COLLIDERS.map((wall, i) => <mesh key={i} position={[wall.x, 1.72, wall.z]} receiveShadow>
      <boxGeometry args={[wall.halfX * 2, 3.6, wall.halfZ * 2]} />
      {wallMaterial}
    </mesh>)}

    {/* Overhead Fluorescent Ceiling Fixtures - Bright corridor and intersection illumination */}
    <MazeFluorescent position={[0, 3.55, -29]} />
    <MazeFluorescent position={[0, 3.55, -33]} />
    <MazeFluorescent position={[4, 3.55, -33]} flicker seed={14} />
    <MazeFluorescent position={[8, 3.55, -33]} />
    <MazeFluorescent position={[0, 3.55, -37]} />
    <MazeFluorescent position={[-4, 3.55, -37]} />
    <MazeFluorescent position={[-8, 3.55, -37]} />
    <MazeFluorescent position={[-8, 3.55, -41]} />
    <MazeFluorescent position={[-4, 3.55, -41]} flicker seed={29} />
    <MazeFluorescent position={[0, 3.55, -41]} />
    <MazeFluorescent position={[4, 3.55, -41]} />
    <MazeFluorescent position={[8, 3.55, -41]} flicker seed={43} />
    <MazeFluorescent position={[8, 3.55, -45]} />
    <MazeFluorescent position={[0, 3.55, -45]} />
    <MazeFluorescent position={[8, 3.55, -49]} />
    <MazeFluorescent position={[4, 3.55, -49]} />
    <MazeFluorescent position={[0, 3.55, -49]} />
    <MazeFluorescent position={[0, 3.55, -53]} />
    <MazeFluorescent position={[-4, 3.55, -53]} />
    <MazeFluorescent position={[-8, 3.55, -53]} flicker seed={58} />
    <MazeFluorescent position={[0, 3.55, -57]} />
    <MazeFluorescent position={[-4, 3.55, -57]} />
    <MazeFluorescent position={[-8, 3.55, -57]} />
    <MazeFluorescent position={[-8, 3.55, -61]} />
    <MazeFluorescent position={[-8, 3.55, -65]} />
    <MazeFluorescent position={[-4, 3.55, -65]} />
    <MazeFluorescent position={[0, 3.55, -65]} />
    <MazeFluorescent position={[4, 3.55, -65]} flicker seed={72} />
    <MazeFluorescent position={[8, 3.55, -65]} />
    <MazeFluorescent position={[8, 3.55, -69]} />
    <MazeFluorescent position={[4, 3.55, -69]} />
    <MazeFluorescent position={[0, 3.55, -69]} />
    <MazeFluorescent position={[-8, 3.55, -69]} flicker seed={86} />

    {/* Occasional Red Emergency Warning Lights */}
    <MazeEmergencyBeacon position={[-9.8, 2.4, -37]} rotation={[0, Math.PI / 2, 0]} />
    <MazeEmergencyBeacon position={[9.8, 2.4, -45]} rotation={[0, -Math.PI / 2, 0]} />
    <MazeEmergencyBeacon position={[-9.8, 2.4, -53]} rotation={[0, Math.PI / 2, 0]} />
    <MazeEmergencyBeacon position={[-9.8, 2.4, -69]} rotation={[0, Math.PI / 2, 0]} />
    <MazeEmergencyBeacon position={[0, 2.6, -67.2]} rotation={[0, 0, 0]} />

    {/* Abandoned Hospital Beds & Stretchers */}
    <HospitalBed position={[1.35, 0, -31]} rotation={[0, -0.15, 0]} />
    <HospitalBed position={[0, 0, -45.5]} rotation={[0, 0.25, 0]} tilted />
    <HospitalBed position={[-1.3, 0, -45.2]} rotation={[0, -0.08, 0]} />
    <HospitalBed position={[-8, 0, -68.8]} rotation={[0, 0.35, 0]} />
    <HospitalBed position={[6.8, 0, -48.8]} rotation={[0, 0.05, 0]} tilted />

    {/* Wheelchairs */}
    <Wheelchair position={[-1.35, 0, -32.5]} rotation={[0, 0.6, 0]} />
    <Wheelchair position={[1.25, 0, -44.5]} rotation={[0, -0.45, 0]} />
    <Wheelchair position={[-6.8, 0, -61]} rotation={[0, 1.2, 0]} />
    <Wheelchair position={[2.5, 0, -64.8]} rotation={[0, -0.85, 0]} />

    {/* Medical Monitors & Crash Carts */}
    <MedicalCrashCart position={[-1.25, 0, -33.5]} rotation={[0, 0.4, 0]} />
    <MedicalCrashCart position={[-0.8, 0, -44.2]} rotation={[0, -0.3, 0]} />
    <MedicalCrashCart position={[-7.2, 0, -56.5]} rotation={[0, 1.1, 0]} />
    <MedicalCrashCart position={[1.25, 0, -68.8]} rotation={[0, -0.2, 0]} />

    {/* Chemical Storage Cabinets (Glowing biological specimen jars) */}
    <ChemicalCabinet position={[8, 0, -31.5]} rotation={[0, Math.PI, 0]} glowColor="#34e88f" />
    <ChemicalCabinet position={[9.4, 0, -33.5]} rotation={[0, -Math.PI / 2, 0]} glowColor="#38d2e8" />
    <ChemicalCabinet position={[-8, 0, -51.5]} rotation={[0, Math.PI, 0]} glowColor="#38d2e8" />
    <ChemicalCabinet position={[-9.4, 0, -53.5]} rotation={[0, Math.PI / 2, 0]} glowColor="#e08a3c" />

    {/* Research Tables & Lab Benches */}
    <LabBench position={[7.2, 0, -33.8]} rotation={[0, -Math.PI / 2, 0]} />
    <LabBench position={[-8, 0, -67.5]} rotation={[0, Math.PI, 0]} />

    {/* Chemical & Biohazard Barrels */}
    <HazardBarrel position={[-9.2, 0, -54.2]} color="#243834" />
    <HazardBarrel position={[-8.4, 0, -54.5]} color="#382d24" />
    <HazardBarrel position={[-9.2, 0, -68.2]} color="#243834" />
    <HazardBarrel position={[9.2, 0, -45.5]} color="#2b3b3a" />

    {/* Hospital & Biohazard Warning Signs */}
    <HospitalWallSign position={[0, 2.35, -27.2]} rotation={[0, 0, 0]} text="SUBLEVEL RESEARCH & ICU" code="BIO-SAFETY LEVEL 4 // QUARANTINE" color="#e8453c" />
    <HospitalWallSign position={[3.8, 2.35, -32.8]} rotation={[0, 0, 0]} text="PALISADE VIROLOGY LAB" code="AUTHORIZED RESEARCH PERSONNEL ONLY" color="#4ec2d1" />
    <HospitalWallSign position={[-0.2, 2.35, -44.8]} rotation={[0, 0, 0]} text="ICU & TRAUMA BAY 02" code="ISOLATION WARD // PATIENTS ONLY" color="#e8b043" />
    <HospitalWallSign position={[-3.8, 2.35, -52.8]} rotation={[0, 0, 0]} text="CRYO-SPECIMEN STORAGE" code="DANGER // SUB-ZERO CHEMICAL HAZARD" color="#4ec2d1" />
    <HospitalWallSign position={[-7.8, 2.35, -68.8]} rotation={[0, 0, 0]} text="FACILITY MORGUE" code="BIO-HAZARD WASTE // AUTHORIZED ONLY" color="#e8453c" />
    <HospitalWallSign position={[-4, 2.35, -64.8]} rotation={[0, 0, 0]} text="SURFACE EVACUATION ROUTE →" code="SECTOR 04 EMERGENCY ESCAPE" color="#54dba6" />

    {/* Leaking Water Puddles */}
    <WaterPuddle position={[0, -30]} scale={[1.4, 0.9]} />
    <WaterPuddle position={[2, -33]} scale={[1.1, 0.7]} />
    <WaterPuddle position={[-6, -37]} scale={[1.5, 1.1]} />
    <WaterPuddle position={[0, -44.8]} scale={[1.6, 1.2]} />
    <WaterPuddle position={[8, -47]} scale={[1.3, 0.8]} />
    <WaterPuddle position={[-8, -54]} scale={[1.8, 1.3]} />
    <WaterPuddle position={[-4, -65]} scale={[1.4, 0.9]} />
    <WaterPuddle position={[2, -69]} scale={[1.2, 0.8]} />

    {/* Overhead Ventilation Ducts */}
    <OverheadVentDuct position={[0, 3.35, -31]} length={6} />
    <OverheadVentDuct position={[-4, 3.35, -41]} rotation={[0, Math.PI / 2, 0]} length={8} />
    <OverheadVentDuct position={[8, 3.35, -47]} length={6} />
    <OverheadVentDuct position={[-8, 3.35, -61]} length={8} />
    <OverheadVentDuct position={[2, 3.35, -65]} rotation={[0, Math.PI / 2, 0]} length={8} />

    {/* Medical Gas & Vacuum Wall Pipes */}
    <WallPipes position={[1.85, 3.1, -31]} length={6} />
    <WallPipes position={[-1.85, 3.1, -31]} length={6} />
    <WallPipes position={[-9.85, 3.1, -41]} length={8} />
    <WallPipes position={[9.85, 3.1, -47]} length={6} />
    <WallPipes position={[-9.85, 3.1, -61]} length={8} />
    <WallPipes position={[0, 3.1, -64.85]} rotation={[0, Math.PI / 2, 0]} length={8} />

    {/* Exposed Hanging Electrical Cables */}
    <HangingCables position={[0.2, 3.5, -35]} />
    <HangingCables position={[-4.2, 3.5, -41]} />
    <HangingCables position={[8.1, 3.5, -43]} />
    <HangingCables position={[-8.1, 3.5, -59]} />
    <HangingCables position={[3.8, 3.5, -65]} />

    {/* Scattered Medical Documents & Papers */}
    <FloorPapers position={[0.3, 0, -32]} rotation={[0, 0.4, 0]} />
    <FloorPapers position={[-0.4, 0, -44.2]} rotation={[0, -0.6, 0]} />
    <FloorPapers position={[7.8, 0, -33.2]} rotation={[0, 1.2, 0]} />
    <FloorPapers position={[-7.6, 0, -53.2]} rotation={[0, -0.3, 0]} />
    <FloorPapers position={[-1, 0, -66]} rotation={[0, 0.8, 0]} />

    {/* Physical Exit At End Of Route */}
    <Box position={[-1.5, 1.7, -71]} scale={[0.18, 3.4, 0.35]} color="#59686c" metalness={0.82} />
    <Box position={[1.5, 1.7, -71]} scale={[0.18, 3.4, 0.35]} color="#59686c" metalness={0.82} />
    <Box position={[0, 3.3, -71]} scale={[3.15, 0.2, 0.35]} color="#59686c" metalness={0.82} />
  </group>
  }, [ceilingMap, floorMap, wallMap])
  const guidance = reveal?.guidance

  return <group>
    {staticMaze}
    {!handgunCollected && <MemoizedHandgunPickup position={HANDGUN_POSITION} />}
    {/* Sonar reveals only the next traversable corridor section, ending at its next junction. */}
    {reveal?.position && guidance?.slice(0,-1).map((cell,index) => <SonarGuideEdge key={`${reveal.id}-${index}`} pulseId={reveal.id} from={cell} to={guidance[index+1]} />)}
    {!mazeExited && <Box position={[0, 1.65, -71.08]} scale={[2.8, 3.05, 0.12]} color="#342d2e" metalness={0.68} />}
    <Text position={[0, 2.3, -70.98]} fontSize={0.2} color={mazeExited ? '#78dbaf' : '#cf8a64'} anchorX="center">{mazeExited ? 'EXIT OPEN' : 'EMERGENCY EXIT'}</Text>
    <ScanPulse reveal={reveal} />
  </group>
}

const monsterFleshTexture = (() => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#4e1015'
  ctx.fillRect(0, 0, 512, 512)
  const tones = ['#38080c', '#5f141b', '#731821', '#260407', '#831e28', '#420b10', '#1c0305']
  for (let i = 0; i < 450; i++) {
    const x = (i * 37) % 512, y = (i * 73) % 512, r = 8 + (i % 22)
    ctx.fillStyle = tones[i % tones.length]
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.38
  for (let y = 0; y < 512; y += 4) {
    ctx.strokeStyle = y % 8 === 0 ? '#1f0306' : '#731821'
    ctx.lineWidth = 1 + (y % 3)
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x < 512; x += 32) {
      ctx.lineTo(x, y + Math.sin(x * 0.06 + y * 0.03) * 6)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 0.55
  for (let v = 0; v < 14; v++) {
    ctx.strokeStyle = '#220307'
    ctx.lineWidth = 2 + (v % 3)
    ctx.beginPath()
    let vx = (v * 43) % 512, vy = (v * 67) % 512
    ctx.moveTo(vx, vy)
    for (let step = 0; step < 8; step++) {
      vx += ((v * 19 + step * 31) % 40) - 20
      vy += 16 + ((step * 17) % 24)
      ctx.lineTo(vx, vy)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 0.75
  for (let b = 0; b < 70; b++) {
    const bx = (b * 59) % 512, by = (b * 97) % 512
    ctx.fillStyle = b % 4 === 0 ? '#180204' : '#5c1016'
    ctx.beginPath()
    ctx.arc(bx, by, 3 + (b % 11), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1.0
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  return tex
})()

const monsterFleshBump = (() => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 350; i++) {
    const x = (i * 29) % 256, y = (i * 47) % 256
    const val = (i % 2 === 0) ? 55 : 185
    ctx.fillStyle = `rgb(${val}, ${val}, ${val})`
    ctx.beginPath()
    ctx.arc(x, y, 2 + (i % 7), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.35
  for (let y = 0; y < 256; y += 3) {
    ctx.strokeStyle = y % 6 === 0 ? '#1c1c1c' : '#c8c8c8'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x < 256; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.12) * 3)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1.0
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 3)
  return tex
})()

const monsterGoreTexture = (() => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3a060a'
  ctx.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 3) {
    const tone = 25 + ((y * 7) % 45)
    ctx.fillStyle = `rgb(${tone + 75}, ${Math.floor(tone / 4)}, ${Math.floor(tone / 3)})`
    ctx.fillRect(0, y, 256, 2)
  }
  ctx.globalAlpha = 0.65
  for (let i = 0; i < 60; i++) {
    const x = (i * 31) % 256, y = (i * 53) % 256
    ctx.fillStyle = '#1e0205'
    ctx.beginPath()
    ctx.arc(x, y, 6 + (i % 12), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1.0
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
})()

const monsterFlesh = new THREE.MeshStandardMaterial({
  color: '#6e151b',
  roughness: 0.78,
  metalness: 0.05,
  map: monsterFleshTexture,
  bumpMap: monsterFleshBump,
  bumpScale: 0.04
})
const monsterGore = new THREE.MeshStandardMaterial({
  color: '#4e090e',
  roughness: 0.24,
  metalness: 0.18,
  map: monsterGoreTexture,
  bumpMap: monsterFleshBump,
  bumpScale: 0.045
})
const monsterNecrotic = new THREE.MeshStandardMaterial({
  color: '#1a0305',
  roughness: 0.94,
  metalness: 0.02
})
const monsterMutant = new THREE.MeshStandardMaterial({
  color: '#841f26',
  roughness: 0.65,
  metalness: 0.08,
  map: monsterFleshTexture
})
const monsterBone = new THREE.MeshStandardMaterial({
  color: '#7a6c58',
  roughness: 0.72,
  metalness: 0.06
})
const monsterClaw = new THREE.MeshStandardMaterial({
  color: '#180608',
  roughness: 0.22,
  metalness: 0.38
})

function MonsterHand({ side }) {
  const fingers = [
    { x: -0.045, len: 0.32, roll: 0.28, pitch: 0.58 },
    { x: -0.015, len: 0.40, roll: 0.08, pitch: 0.62 },
    { x: 0.015, len: 0.36, roll: -0.12, pitch: 0.60 },
    { x: 0.045, len: 0.28, roll: -0.32, pitch: 0.55 },
  ]
  return <group>
    {/* Bulky mutated muscular palm */}
    <mesh material={monsterFlesh} castShadow><boxGeometry args={[0.13, 0.15, 0.05]} /></mesh>
    {/* Raw torn muscle / exposed gore on back of hand */}
    <mesh position={[0, -0.01, 0.027]} material={monsterGore}><boxGeometry args={[0.07, 0.09, 0.01]} /></mesh>
    {/* Visible mutated metacarpal tendon ridges */}
    {[-0.035, -0.012, 0.012, 0.035].map((tx) => (
      <mesh key={tx} position={[tx, 0.01, 0.026]} rotation={[0.05, 0, 0]} material={monsterBone}>
        <boxGeometry args={[0.01, 0.11, 0.012]} />
      </mesh>
    ))}
    {/* Opposable mutated thumb */}
    <group position={[-0.065 * side, 0.02, 0.015]} rotation={[0.35, side * 0.45, -0.45 * side]}>
      <mesh position={[0, -0.07, 0]} material={monsterFlesh}><cylinderGeometry args={[0.014, 0.018, 0.14, 5]} /></mesh>
      <mesh position={[0, -0.14, 0]} material={monsterBone}><sphereGeometry args={[0.018, 5, 5]} /></mesh>
      <mesh position={[0, -0.20, 0.01]} rotation={[0.3, 0, 0]} material={monsterFlesh}><cylinderGeometry args={[0.011, 0.015, 0.12, 5]} /></mesh>
      <mesh position={[0, -0.27, 0.03]} rotation={[1.2, 0, 0]} material={monsterClaw}><coneGeometry args={[0.016, 0.09, 4]} /></mesh>
    </group>
    {/* 4 Elongated disturbing fingers with knuckles and claws */}
    {fingers.map((f, i) => (
      <group key={i} position={[f.x * side, -0.07, 0.01]} rotation={[f.pitch, 0, f.roll * side]}>
        <mesh position={[0, -f.len * 0.28, 0]} material={monsterFlesh}>
          <cylinderGeometry args={[0.012, 0.016, f.len * 0.56, 5]} />
        </mesh>
        <mesh position={[0, -f.len * 0.56, 0]} material={monsterBone}>
          <sphereGeometry args={[0.016, 5, 5]} />
        </mesh>
        <mesh position={[0, -f.len * 0.78, 0.01]} rotation={[0.22, 0, 0]} material={monsterFlesh}>
          <cylinderGeometry args={[0.009, 0.013, f.len * 0.44, 5]} />
        </mesh>
        <mesh position={[0, -f.len - 0.035, 0.03]} rotation={[1.05, 0, 0]} material={monsterClaw}>
          <coneGeometry args={[0.015, 0.10, 4]} />
        </mesh>
      </group>
    ))}
  </group>
}

function Monster({ noise, onMode, onSound, onAttack, gameOver, dormantCctv = false, dead = false, monsterObjectRef }) {
  const { camera } = useThree()
  const body = useRef(), route = useRef([]), routeIndex = useRef(0), lastNoiseId = useRef(null), mode = useRef('dormant'), lastStep = useRef(0), searchStart=useRef(null)
  const neck = useRef(), jaw = useRef(), armL = useRef(), armR = useRef(), legL = useRef(), legR = useRef(), chest = useRef()
  const deathStarted = useRef(null), deathPose = useRef(null)
  const worldPosition = useRef(new THREE.Vector3(dormantCctv ? 4.05 : 8, 0.1, dormantCctv ? -15.5 : -65))
  const lastAttackTime = useRef(-999)
  useEffect(() => {
    if (!dormantCctv || !body.current) return
    body.current.position.copy(worldPosition.current)
    body.current.rotation.y = Math.atan2(1.25, 4.3)
    body.current.traverse((object) => object.layers.set(CCTV_LAYER))
  }, [dormantCctv])
  useEffect(() => {
    if (!monsterObjectRef) return
    monsterObjectRef.current = body.current
    return () => { if (monsterObjectRef.current === body.current) monsterObjectRef.current = null }
  }, [monsterObjectRef])
  useEffect(() => {
    if (dormantCctv) return
    if (!noise || noise.id === lastNoiseId.current) return
    lastNoiseId.current = noise.id
    const cellFor = (x,z) => [THREE.MathUtils.clamp(Math.round(x / 4 + 2),0,4),THREE.MathUtils.clamp(Math.round((-z - 29) / 4),0,10)]
    const from = cellFor(worldPosition.current.x, worldPosition.current.z), to = cellFor(noise.position[0], noise.position[1])
    route.current = mazePath(from,to).map((cell) => mazeCellPosition(cell))
    route.current.push([noise.position[0],noise.position[1]])
    routeIndex.current = 0
    searchStart.current=null
    if (body.current) body.current.visible = true
  }, [noise, onSound, dormantCctv])
  useFrame(({ clock }, dt) => {
    if (dormantCctv) {
      if (!body.current) return
      const reveal = CCTV_REVEAL_STATE
      if (reveal.phase === 'unseen') { body.current.visible = false; return }
      const elapsed = Math.max(0, (performance.now() - reveal.startedAt) / 1000)
      const appearance = THREE.MathUtils.smoothstep(elapsed, 1.45, 2.65)
      const approach = THREE.MathUtils.smoothstep(elapsed, 2.35, 6.25)
      const shadowDrift = elapsed >= 1.25 && elapsed < 2.35 ? Math.sin(elapsed * 7) * 0.035 : 0
      worldPosition.current.set(4.05 + shadowDrift + approach * 0.45, 0.1, -15.5 + approach * 1.35)
      body.current.position.copy(worldPosition.current)
      body.current.rotation.y = Math.atan2(1.2 - approach * 0.45, 4.3 - approach * 1.35)
      body.current.scale.setScalar(reveal.phase === 'lost' ? 1 : 0.12 + appearance * 0.88)
      body.current.visible = elapsed >= 1.45 || reveal.phase === 'glitch' || reveal.phase === 'lost'
      return
    }
    if (gameOver && body.current) {
      if (!deathPose.current) deathPose.current = {
        x: worldPosition.current.x, z: worldPosition.current.z, yaw: body.current.rotation.y,
        playerX: camera.position.x, playerZ: camera.position.z
      }
      const elapsed = Math.max(0, performance.now() - DEATH_CINEMATIC_STATE.startedAt) / 1000
      const t = THREE.MathUtils.clamp(elapsed / (DEATH_CINEMATIC_STATE.durationMs / 1000), 0, 1)
      const turn = THREE.MathUtils.smoothstep(t, 0, 0.2)
      const grab = THREE.MathUtils.smoothstep(t, 0.12, 0.48)
      const lunge = THREE.MathUtils.smoothstep(t, 0.28, 0.72)
      const pose = deathPose.current
      const dx = pose.playerX - pose.x, dz = pose.playerZ - pose.z
      const distance = Math.max(0.001, Math.hypot(dx, dz))
      const targetYaw = Math.atan2(dx, dz)
      const yawDelta = Math.atan2(Math.sin(targetYaw - pose.yaw), Math.cos(targetYaw - pose.yaw))
      body.current.rotation.y = pose.yaw + yawDelta * turn
      worldPosition.current.set(pose.x + dx / distance * 0.28 * lunge, 0.1, pose.z + dz / distance * 0.28 * lunge)
      body.current.position.copy(worldPosition.current)
      if (armL.current) armL.current.rotation.set(0.16 - grab * 1.12, -grab * 0.14, -0.18 - grab * 0.24)
      if (armR.current) armR.current.rotation.set(0.22 - grab * 1.12, grab * 0.14, 0.18 + grab * 0.24)
      if (jaw.current) jaw.current.rotation.x = 0.58 + THREE.MathUtils.smoothstep(t, 0.4, 0.78) * 0.72
      if (!DEATH_CINEMATIC_STATE.impactSoundPlayed && elapsed >= 4.65) {
        DEATH_CINEMATIC_STATE.impactSoundPlayed = true
        onSound('monsterAttack')
      }
      return
    }
    if (dead) {
      if (!body.current) return
      if (deathStarted.current === null) deathStarted.current = clock.elapsedTime
      const progress = THREE.MathUtils.clamp((clock.elapsedTime - deathStarted.current) / 0.85, 0, 1)
      body.current.scale.setScalar(Math.max(0.015, 1 - progress))
      body.current.rotation.z = -progress * 1.25
      if (progress >= 1) body.current.visible = false
      return
    }
    if (deathStarted.current !== null) { deathStarted.current = null; if (body.current) body.current.rotation.z = 0 }
    if (!noise || !body.current || gameOver) return
    const age = clock.elapsedTime - (noise.clockTime ?? 0)
    if(age>=25){body.current.visible=false;if(mode.current!=='quiet'){mode.current='quiet';onMode('quiet')}return}
    const point = route.current[routeIndex.current]
    let moving = false
    if (point && age < 23) {
      const dx = point[0] - worldPosition.current.x, dz = point[1] - worldPosition.current.z
      const d = Math.hypot(dx,dz)
      if (d < 0.32 && routeIndex.current < route.current.length - 1) routeIndex.current++
      else if (d > 0.15) {
        const speed = d < 4.5 ? 2.65 : 1.45
        worldPosition.current.x += (dx / d) * speed * Math.min(dt,0.04)
        worldPosition.current.z += (dz / d) * speed * Math.min(dt,0.04)
        body.current.rotation.y = Math.atan2(dx,dz)
        moving = true
      }
    }
    if(age<23&&!moving&&routeIndex.current>=route.current.length-1&&route.current.length){
      if(searchStart.current===null)searchStart.current=clock.elapsedTime
      const t=clock.elapsedTime-searchStart.current,tx=noise.position[0]+Math.cos(t*1.6)*0.8,tz=noise.position[1]+Math.sin(t*1.6)*0.8
      const dx=tx-worldPosition.current.x,dz=tz-worldPosition.current.z,d=Math.hypot(dx,dz)
      if(d>0.12){worldPosition.current.x+=(dx/d)*0.75*Math.min(dt,0.04);worldPosition.current.z+=(dz/d)*0.75*Math.min(dt,0.04);body.current.rotation.y=Math.atan2(dx,dz);moving=true}
    }
    const distToSignal = Math.hypot(worldPosition.current.x-noise.position[0],worldPosition.current.z-noise.position[1])
    const nextMode = age > 23 ? 'forgetting' : (distToSignal < 5 ? 'hunting last signal' : (moving ? 'searching signal' : 'searching last location'))
    if (mode.current !== nextMode) { mode.current = nextMode; onMode(nextMode); if (nextMode === 'hunting last signal') onSound('chase') }
    if (moving && clock.elapsedTime - lastStep.current > (distToSignal < 5 ? 0.42 : 0.72)) { lastStep.current = clock.elapsedTime; onSound('footstep') }
    body.current.position.copy(worldPosition.current)
    body.current.visible = age < 25
    body.current.scale.setScalar(age > 19 ? Math.max(0.04, (25-age)/6) : 1)
    if (body.current.visible && age < 25 && !gameOver) {
      const distToPlayer = Math.hypot(worldPosition.current.x - camera.position.x, worldPosition.current.z - camera.position.z)
      if (distToPlayer <= 1.5) {
        if (clock.elapsedTime - lastAttackTime.current >= 1.5) {
          lastAttackTime.current = clock.elapsedTime
          onSound('monsterAttack')
          onAttack?.()
        }
      }
    }
    const gait = moving ? Math.sin(clock.elapsedTime * 8.2) : Math.sin(clock.elapsedTime * 1.1) * 0.22
    if (armL.current) armL.current.rotation.x = 0.16 + gait * (moving ? 0.26 : 0.05)
    if (armR.current) armR.current.rotation.x = 0.22 - gait * (moving ? 0.26 : 0.05)
    if (legL.current) legL.current.rotation.x = gait * (moving ? 0.38 : 0.02)
    if (legR.current) legR.current.rotation.x = -gait * (moving ? 0.38 : 0.02)
    if (neck.current) {
      neck.current.rotation.x = 0.28 + Math.sin(clock.elapsedTime * 0.85) * 0.05
      neck.current.rotation.y = Math.sin(clock.elapsedTime * 0.55) * 0.2
      neck.current.rotation.z = Math.sin(clock.elapsedTime * 0.33) * 0.14
    }
    if (chest.current) chest.current.scale.y = 1 + Math.sin(clock.elapsedTime * (moving ? 6.4 : 1.5)) * 0.018
  })
  return <group ref={body} visible={dormantCctv && CCTV_REVEAL_STATE.phase !== 'unseen'}>
    {/* Thick Muscular Legs */}
    {[-1, 1].map((side) => <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.14, 1.08, 0]}>
      {/* Bulky muscular thigh */}
      <mesh position={[side * 0.015, -0.26, 0.02]} rotation={[0.08, 0, side * -0.02]} material={monsterFlesh} castShadow>
        <capsuleGeometry args={[0.082, 0.36, 4, 8]} />
      </mesh>
      {/* Lateral quadricep bulge */}
      <mesh position={[side * 0.065, -0.24, 0.01]} scale={[0.045, 0.16, 0.055]} material={monsterFlesh}>
        <sphereGeometry args={[1, 6, 6]} />
      </mesh>
      {/* Torn flesh and raw muscle striations on thigh */}
      <mesh position={[side * 0.01, -0.28, 0.085]} scale={[0.042, 0.12, 0.02]} material={monsterGore}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      {/* Dark necrotic decay patch on outer thigh */}
      <mesh position={[side * 0.07, -0.32, 0.02]} scale={[0.03, 0.08, 0.04]} material={monsterNecrotic}>
        <sphereGeometry args={[1, 5, 5]} />
      </mesh>

      {/* Bulky knee joint */}
      <mesh position={[side * 0.02, -0.52, 0.03]} material={monsterFlesh}>
        <sphereGeometry args={[0.07, 7, 7]} />
      </mesh>
      {/* Diseased, exposed patella bone */}
      <mesh position={[side * 0.02, -0.51, 0.085]} rotation={[0.2, 0, 0]} material={monsterBone}>
        <sphereGeometry args={[0.042, 6, 5]} />
      </mesh>

      {/* Thick muscular calf and lower leg */}
      <mesh position={[side * 0.022, -0.76, 0.02]} rotation={[-0.14, 0, side * 0.02]} material={monsterFlesh} castShadow>
        <capsuleGeometry args={[0.068, 0.34, 4, 8]} />
      </mesh>
      {/* Exposed tibia ridge */}
      <mesh position={[side * 0.022, -0.74, 0.075]} rotation={[-0.14, 0, 0]} material={monsterBone}>
        <boxGeometry args={[0.024, 0.32, 0.02]} />
      </mesh>
      {/* Heavy Achilles tendon */}
      <mesh position={[side * 0.022, -0.85, -0.04]} rotation={[-0.14, 0, 0]} material={monsterGore}>
        <cylinderGeometry args={[0.018, 0.022, 0.22, 5]} />
      </mesh>

      {/* Foot & Talons */}
      <mesh position={[side * 0.025, -1.0, 0.06]} material={monsterFlesh} castShadow>
        <boxGeometry args={[0.13, 0.07, 0.22]} />
      </mesh>
      <mesh position={[side * 0.025, -0.99, -0.04]} material={monsterNecrotic}>
        <sphereGeometry args={[0.045, 5, 5]} />
      </mesh>
      {/* Outer claw */}
      <mesh position={[side * 0.07, -1.01, 0.18]} rotation={[1.25, 0, side * 0.2]} material={monsterClaw}>
        <coneGeometry args={[0.02, 0.11, 4]} />
      </mesh>
      {/* Center claw */}
      <mesh position={[side * 0.025, -1.01, 0.20]} rotation={[1.2, 0, 0]} material={monsterClaw}>
        <coneGeometry args={[0.022, 0.12, 4]} />
      </mesh>
      {/* Inner claw */}
      <mesh position={[side * -0.02, -1.01, 0.17]} rotation={[1.25, 0, side * -0.15]} material={monsterClaw}>
        <coneGeometry args={[0.018, 0.10, 4]} />
      </mesh>
      {/* Rear talon */}
      <mesh position={[side * 0.025, -0.98, -0.07]} rotation={[-1.1, 0, 0]} material={monsterClaw}>
        <coneGeometry args={[0.016, 0.07, 4]} />
      </mesh>
    </group>)}

    {/* Pelvis / Hip base */}
    <mesh position={[0, 1.08, 0]} material={monsterFlesh} castShadow>
      <boxGeometry args={[0.34, 0.14, 0.22]} />
    </mesh>
    {/* Abdominal laceration / raw gore */}
    <mesh position={[0, 1.12, 0.095]} material={monsterGore}>
      <boxGeometry args={[0.12, 0.16, 0.05]} />
    </mesh>
    {/* Muscular lower abdomen */}
    <mesh position={[0, 1.28, 0.03]} material={monsterFlesh} castShadow>
      <boxGeometry args={[0.32, 0.24, 0.20]} />
    </mesh>
    {/* Necrotic decay patches on abdomen */}
    <mesh position={[-0.08, 1.26, 0.12]} scale={[0.05, 0.07, 0.03]} material={monsterNecrotic}>
      <sphereGeometry args={[1, 5, 5]} />
    </mesh>

    {/* Dorsal spinal column & mutated bone spikes along back */}
    {[1.18, 1.32, 1.46, 1.60, 1.74, 1.88, 2.0].map((y) => (
      <group key={y} position={[0, y, -0.09]}>
        <mesh material={monsterBone}><boxGeometry args={[0.05, 0.06, 0.05]} /></mesh>
        <mesh position={[0, 0, -0.05]} rotation={[-0.45, 0, 0]} material={monsterBone}><coneGeometry args={[0.018, 0.12, 4]} /></mesh>
      </group>
    ))}

    {/* Broad Upper Chest / Thorax */}
    <group ref={chest} position={[0, 1.64, 0.02]}>
      {/* Massive muscular chest mass */}
      <mesh scale={[0.26, 0.36, 0.17]} material={monsterFlesh} castShadow>
        <sphereGeometry args={[1, 10, 8]} />
      </mesh>
      {/* Muscular Pectorals */}
      <mesh position={[-0.12, 0.08, 0.12]} scale={[0.11, 0.11, 0.08]} material={monsterFlesh}>
        <sphereGeometry args={[1, 8, 6]} />
      </mesh>
      <mesh position={[0.12, 0.08, 0.12]} scale={[0.11, 0.11, 0.08]} material={monsterFlesh}>
        <sphereGeometry args={[1, 8, 6]} />
      </mesh>
      {/* Deep sternum incision / autopsy cleft */}
      <mesh position={[0, 0.04, 0.15]} material={monsterGore}>
        <boxGeometry args={[0.045, 0.32, 0.04]} />
      </mesh>
      {/* Swollen mutated shoulder hump / biological tumor (left shoulder) */}
      <mesh position={[-0.20, 0.18, -0.04]} scale={[0.13, 0.12, 0.14]} material={monsterMutant} castShadow>
        <sphereGeometry args={[1, 8, 7]} />
      </mesh>
      <mesh position={[-0.24, 0.24, -0.02]} scale={[0.045, 0.045, 0.045]} material={monsterGore}>
        <sphereGeometry args={[1, 6, 5]} />
      </mesh>
      <mesh position={[-0.17, 0.26, -0.08]} scale={[0.038, 0.038, 0.038]} material={monsterGore}>
        <sphereGeometry args={[1, 6, 5]} />
      </mesh>
      {/* Broken protruding ribs (right flank) */}
      {[0.14, 0.04, -0.06, -0.16, -0.24].map((y, i) => (
        <group key={y} position={[0.08, y, 0.02]}>
          <mesh rotation={[Math.PI / 2.1, Math.PI * 0.95, -0.15]} material={monsterBone}>
            <torusGeometry args={[0.18 - i * 0.01, 0.013, 4, 10, Math.PI * 0.9]} />
          </mesh>
          <mesh position={[0.14, -0.02, 0.06]} rotation={[0.2, 0.3, 1.2]} material={monsterBone}>
            <coneGeometry args={[0.014, 0.08, 4]} />
          </mesh>
          <mesh position={[0.12, -0.02, 0.04]} scale={[0.04, 0.04, 0.03]} material={monsterGore}>
            <sphereGeometry args={[1, 5, 5]} />
          </mesh>
        </group>
      ))}
      {/* Muscular upper back / lats */}
      <mesh position={[0, 0.12, -0.12]} scale={[0.24, 0.26, 0.11]} material={monsterFlesh}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
    </group>

    {/* Broad Muscular Shoulder Girdle */}
    <mesh position={[0, 1.98, -0.01]} rotation={[0.06, 0, 0]} material={monsterFlesh} castShadow>
      <boxGeometry args={[0.54, 0.10, 0.22]} />
    </mesh>
    <mesh position={[-0.16, 2.03, -0.05]} scale={[0.09, 0.07, 0.09]} material={monsterFlesh}>
      <sphereGeometry args={[1, 7, 6]} />
    </mesh>
    <mesh position={[0.16, 2.03, -0.05]} scale={[0.08, 0.06, 0.08]} material={monsterFlesh}>
      <sphereGeometry args={[1, 7, 6]} />
    </mesh>

    {/* Head & Neck */}
    <group ref={neck} position={[0.015, 2.02, 0.02]} rotation={[0.28, 0.15, -0.12]}>
      {/* Thick muscular corded neck */}
      <mesh position={[0, 0.18, 0.01]} material={monsterFlesh} castShadow>
        <cylinderGeometry args={[0.085, 0.115, 0.36, 8]} />
      </mesh>
      {/* Bulging neck muscle bands */}
      <mesh position={[-0.065, 0.18, 0.04]} rotation={[0.1, 0, -0.2]} material={monsterFlesh}>
        <capsuleGeometry args={[0.032, 0.26, 3, 6]} />
      </mesh>
      <mesh position={[0.065, 0.18, 0.04]} rotation={[0.1, 0, 0.2]} material={monsterFlesh}>
        <capsuleGeometry args={[0.032, 0.26, 3, 6]} />
      </mesh>
      {/* Raw exposed throat / torn trachea */}
      <mesh position={[0, 0.18, 0.095]} material={monsterGore}>
        <boxGeometry args={[0.06, 0.22, 0.03]} />
      </mesh>
      {/* Cervical vertebrae */}
      <mesh position={[0, 0.18, -0.08]} material={monsterBone}>
        <boxGeometry args={[0.04, 0.24, 0.03]} />
      </mesh>

      {/* Horrifying Zombie-Like Mutant Head */}
      <group position={[0.02, 0.44, 0.04]} rotation={[0.18, 0.1, -0.15]}>
        {/* Cranium */}
        <mesh scale={[0.16, 0.21, 0.19]} material={monsterFlesh} castShadow>
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
        {/* Swollen mutated cranial lobe (left side) */}
        <mesh position={[-0.08, 0.08, -0.02]} scale={[0.09, 0.09, 0.08]} material={monsterMutant}>
          <sphereGeometry args={[1, 7, 6]} />
        </mesh>
        <mesh position={[-0.12, 0.12, -0.01]} scale={[0.035, 0.035, 0.035]} material={monsterGore}>
          <sphereGeometry args={[1, 5, 5]} />
        </mesh>
        {/* Fractured parietal skull bone (right side) */}
        <mesh position={[0.09, 0.07, 0.02]} rotation={[0.15, -0.2, 0.4]} material={monsterBone}>
          <boxGeometry args={[0.08, 0.08, 0.02]} />
        </mesh>
        {/* Heavy menacing brow ridge */}
        <mesh position={[0, 0.065, 0.14]} rotation={[0.1, 0, 0]} material={monsterFlesh}>
          <boxGeometry args={[0.22, 0.04, 0.08]} />
        </mesh>

        {/* Eyeless Orbital Cavities (No functional eyes) */}
        <mesh position={[-0.055, 0.025, 0.16]} rotation={[0.15, 0.2, 0]} material={monsterNecrotic}>
          <boxGeometry args={[0.048, 0.035, 0.05]} />
        </mesh>
        <mesh position={[0.055, 0.025, 0.16]} rotation={[0.15, -0.2, 0]} material={monsterNecrotic}>
          <boxGeometry args={[0.048, 0.035, 0.05]} />
        </mesh>
        {/* Black necrotic fluid weeping down cheeks */}
        <mesh position={[-0.055, -0.03, 0.165]} material={monsterNecrotic}>
          <boxGeometry args={[0.015, 0.07, 0.01]} />
        </mesh>
        <mesh position={[0.055, -0.03, 0.165]} material={monsterNecrotic}>
          <boxGeometry args={[0.015, 0.07, 0.01]} />
        </mesh>

        {/* Collapsed Decomposed Nasal Cavity */}
        <mesh position={[0, -0.03, 0.17]} rotation={[0.4, 0, 0]} material={monsterNecrotic}>
          <coneGeometry args={[0.025, 0.045, 3]} />
        </mesh>

        {/* Upper Maxilla & Upper Jagged Teeth */}
        <mesh position={[0, -0.08, 0.13]} material={monsterFlesh}>
          <boxGeometry args={[0.16, 0.05, 0.10]} />
        </mesh>
        {[-0.06, -0.03, 0, 0.03, 0.06].map((tx) => (
          <mesh key={tx} position={[tx, -0.105, 0.17]} rotation={[Math.PI, 0, 0]} material={monsterBone}>
            <coneGeometry args={[0.012, 0.035, 4]} />
          </mesh>
        ))}

        {/* Distorted, Dislocated Lower Jaw (Mandible) */}
        <group ref={jaw} position={[0.015, -0.11, 0.08]} rotation={[0.58, 0.12, -0.18]}>
          {/* Lower jaw bone & flesh */}
          <mesh position={[0, -0.06, 0.08]} material={monsterFlesh}>
            <boxGeometry args={[0.14, 0.055, 0.16]} />
          </mesh>
          {/* Gaping open mouth interior */}
          <mesh position={[0, -0.02, 0.06]} material={monsterGore}>
            <boxGeometry args={[0.11, 0.04, 0.12]} />
          </mesh>
          {/* Lower jagged, broken teeth row */}
          {[-0.05, -0.025, 0, 0.025, 0.05].map((tx) => (
            <mesh key={tx} position={[tx, -0.025, 0.15]} material={monsterBone}>
              <coneGeometry args={[0.013, 0.04, 4]} />
            </mesh>
          ))}
          {/* Deformed chin lesion */}
          <mesh position={[0.01, -0.09, 0.14]} material={monsterNecrotic}>
            <sphereGeometry args={[0.035, 5, 5]} />
          </mesh>
        </group>

        {/* Visceral torn cheek sinew bridging upper and lower jaws */}
        <mesh position={[-0.07, -0.09, 0.12]} rotation={[0.3, 0, 0.35]} material={monsterGore}>
          <cylinderGeometry args={[0.008, 0.012, 0.08, 4]} />
        </mesh>
        <mesh position={[0.07, -0.09, 0.12]} rotation={[0.3, 0, -0.35]} material={monsterGore}>
          <cylinderGeometry args={[0.008, 0.012, 0.08, 4]} />
        </mesh>
      </group>
    </group>

    {/* Thick Muscular Arms with Large Claws */}
    {[-1, 1].map((side) => <group key={side} ref={side < 0 ? armL : armR} position={[side * 0.26, side < 0 ? 1.98 : 1.92, 0.01]} rotation={[side < 0 ? 0.16 : 0.22, 0, side * 0.18]}>
      {/* Muscular Deltoid / Shoulder */}
      <mesh position={[side * 0.02, -0.04, 0]} material={monsterFlesh} castShadow>
        <sphereGeometry args={[0.105, 8, 8]} />
      </mesh>
      <mesh position={[side * 0.08, -0.02, 0.04]} scale={[0.04, 0.04, 0.04]} material={monsterGore}>
        <sphereGeometry args={[1, 5, 5]} />
      </mesh>

      {/* Bulky Muscular Upper Arm (Biceps & Triceps) */}
      <mesh position={[side * 0.02, -0.36, 0.01]} rotation={[0.05, 0, side * 0.02]} material={monsterFlesh} castShadow>
        <capsuleGeometry args={[0.078, 0.48, 4, 8]} />
      </mesh>
      {/* Bulging bicep peak */}
      <mesh position={[side * 0.03, -0.32, 0.06]} scale={[0.055, 0.14, 0.055]} material={monsterFlesh}>
        <sphereGeometry args={[1, 6, 6]} />
      </mesh>
      {/* Tricep striation / torn flesh */}
      <mesh position={[side * 0.02, -0.38, -0.055]} scale={[0.04, 0.16, 0.02]} material={monsterGore}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>

      {/* Knobby Elbow Joint */}
      <mesh position={[side * 0.025, -0.68, -0.02]} material={monsterFlesh}>
        <sphereGeometry args={[0.065, 6, 6]} />
      </mesh>
      <mesh position={[side * 0.025, -0.69, -0.07]} rotation={[-0.4, 0, 0]} material={monsterBone}>
        <coneGeometry args={[0.02, 0.06, 4]} />
      </mesh>

      {/* Thick Muscular Forearm */}
      <mesh position={[side * 0.032, -1.06, 0.03]} rotation={[0.14, 0, side * 0.03]} material={monsterFlesh} castShadow>
        <capsuleGeometry args={[0.068, 0.58, 4, 8]} />
      </mesh>
      {/* Muscular brachioradialis bulge */}
      <mesh position={[side * 0.075, -0.92, 0.04]} scale={[0.045, 0.16, 0.045]} material={monsterFlesh}>
        <sphereGeometry args={[1, 6, 6]} />
      </mesh>
      {/* Visceral wrist tendons & sinew */}
      <mesh position={[side * 0.035, -1.36, 0.06]} material={monsterGore}>
        <boxGeometry args={[0.06, 0.08, 0.05]} />
      </mesh>
      {/* Experiment restraint cuff / surgical band */}
      <mesh position={[side * 0.032, -1.22, 0.04]} rotation={[Math.PI / 2, 0, 0]} material={monsterNecrotic}>
        <torusGeometry args={[0.069, 0.009, 4, 12]} />
      </mesh>

      {/* Terrifying Large Hand with Long Claws */}
      <group position={[side * 0.04, -1.52, 0.07]} rotation={[0.42, side * 0.15, side * 0.22]}>
        <MonsterHand side={side} />
      </group>
    </group>)}
  </group>
}

const MemoizedMonster = memo(Monster)

function Environment({ powerRestored, fuseCollected, researchReviewed, scannerCollected }) {
  const floorMap = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#9ea8a6'
    ctx.fillRect(0, 0, 512, 512)
    const tileSize = 64
    for (let x = 0; x < 512; x += tileSize) {
      for (let y = 0; y < 512; y += tileSize) {
        const shade = Math.floor(140 + ((x * 19 + y * 29) % 32))
        ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 1})`
        ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2)
        ctx.strokeStyle = '#5e6865'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, tileSize, tileSize)
      }
    }
    const rand = createRng(190734863)
    for (let i = 0; i < 35; i++) {
      const sx = rand() * 512, sy = rand() * 512, r = rand() * 50 + 8
      const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, r)
      grad.addColorStop(0, rand() > 0.6 ? 'rgba(50, 12, 12, 0.32)' : 'rgba(28, 32, 26, 0.25)')
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(22, 26, 22, 0.52)'
    ctx.lineWidth = 1.5
    for (let c = 0; c < 15; c++) {
      let cx = rand() * 512, cy = rand() * 512
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      for (let s = 0; s < 4; s++) {
        cx += (rand() - 0.5) * 40
        cy += (rand() - 0.5) * 40
        ctx.lineTo(cx, cy)
      }
      ctx.stroke()
    }
    const map = new THREE.CanvasTexture(canvas)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(4, 12)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
    return map
  }, [])

  const facilityWallMap = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#b8c0be'
    ctx.fillRect(0, 0, 512, 330)
    ctx.fillStyle = '#4a6358'
    ctx.fillRect(0, 330, 512, 182)
    ctx.fillStyle = '#283830'
    ctx.fillRect(0, 324, 512, 12)
    ctx.fillStyle = '#1c2420'
    ctx.fillRect(0, 494, 512, 18)
    const rand = createRng(38472)
    for (let s = 0; s < 25; s++) {
      const wx = rand() * 512, ww = rand() * 22 + 6
      const grad = ctx.createLinearGradient(wx, 0, wx, 512)
      grad.addColorStop(0, 'rgba(20, 28, 24, 0.10)')
      grad.addColorStop(0.7, 'rgba(20, 28, 24, 0.20)')
      grad.addColorStop(1, 'rgba(10, 15, 12, 0.30)')
      ctx.fillStyle = grad
      ctx.fillRect(wx, 0, ww, 512)
    }
    const map = new THREE.CanvasTexture(canvas)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(4, 1)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  const staticEnvironment = useMemo(() => {
    const wallMaterial = <meshStandardMaterial map={facilityWallMap} roughness={0.82} metalness={0.15} />
    return <>
    <color attach="background" args={['#080c0a']} />
    <ambientLight intensity={powerRestored ? 0.78 : 0.48} color={powerRestored ? '#d8d0c0' : '#b4aea0'} />
    <hemisphereLight intensity={powerRestored ? 0.72 : 0.50} color="#d4cfc0" groundColor="#28241e" />
    <PowerSurge active={powerRestored} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, -7]} receiveShadow>
      <planeGeometry args={[13, 40]} /><meshStandardMaterial map={floorMap} color="#f2ede5" roughness={0.65} metalness={0.15} />
    </mesh>
    <mesh position={[0, 3.8, -7]} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[13, 40]} /><meshStandardMaterial color="#262822" roughness={0.9} />
    </mesh>
    {WALLS.map(([x, z, w, d], i) => <mesh key={i} position={[x, 1.9, z]} castShadow receiveShadow>
      <boxGeometry args={[w, 3.8, d]} />{wallMaterial}
    </mesh>)}
    {/* industrial wall ribs and floor guides */}
    {Array.from({ length: 13 }, (_, i) => {
      const z = 11 - i * 3.05
      return <group key={i}>
        {[-5.88, 5.88].map((x) => <ReactFragment key={x}>
          <Box position={[x * 1.008, 1.88, z]} scale={[0.09, 2.15, 2.55]} color={i % 3 === 0 ? '#29383e' : '#222e34'} metalness={0.74} roughness={0.42} />
          <Box position={[x, 1.85, z]} scale={[0.13, 3.65, 0.17]} color="#35434a" />
          <Box position={[x * 0.94, 3.05, z]} scale={[0.65, 0.12, 0.16]} color="#33434a" />
        </ReactFragment>)}
        <StripLight position={[0, 3.55, z - 1.1]} intensity={powerRestored ? (i % 4 === 2 ? 0.75 : 5.5) : (i % 4 === 2 ? 0.35 : 3.8)} color={i % 4 === 2 ? '#a24743' : (powerRestored ? '#f0ebe0' : '#d4cfc0')} lit={powerRestored ? i % 3 !== 1 : i % 2 === 0} powered={powerRestored} flicker={!powerRestored && (i === 4 || i === 10)} />
        <Box position={[-2.8, -0.055, z]} scale={[0.035, 0.012, 2.35]} color="#a58a55" metalness={0.65} />
        <Box position={[2.8, -0.055, z]} scale={[0.035, 0.012, 2.35]} color="#a58a55" metalness={0.65} />
        {i % 4 === 0 && [-4.75, 4.75].map((x) => <group key={x} position={[x, -0.102, z - 0.45]}>
          <Box position={[0, 0, 0]} scale={[0.72, 0.012, 0.055]} color="#c69a4f" metalness={0.25} />
          {[-0.23, -0.08, 0.07, 0.22].map((mark) => <Box key={mark} position={[mark, 0.008, 0]} rotation={[0, 0, -0.45]} scale={[0.07, 0.008, 0.065]} color="#1b2326" metalness={0.1} />)}
        </group>)}
        {i % 3 === 0 && <group position={[-5.94, 1.6, z - 1.05]}>
          <Box position={[0, 0, 0]} scale={[0.05, 0.72, 1.05]} color="#46545a" metalness={0.72} />
          {Array.from({ length: 7 }, (_, vent) => <Box key={vent} position={[-0.04, -0.27 + vent * 0.09, 0]} scale={[0.025, 0.025, 0.9]} color="#182328" metalness={0.65} />)}
          <mesh position={[-0.045, 0.61, 0.37]}><sphereGeometry args={[0.07, 8, 8]} /><meshBasicMaterial color="#d14942" /></mesh>
        </group>}
        {i % 4 === 1 && <group position={[5.92, 1.18, z]}>
          <Box position={[0, 0, 0]} scale={[0.08, 0.9, 0.95]} color="#38474d" metalness={0.72} />
          {[-0.29, -0.1, 0.1, 0.29].map((stripe) => <Box key={stripe} position={[-0.05, 0, stripe]} scale={[0.018, 0.9, 0.07]} color={Math.abs(stripe) === 0.29 ? '#c8893f' : '#20292d'} metalness={0.25} />)}
        </group>}
      </group>
    })}
    {/* overhead conduit runs */}
    {[-1.55, -1.15, 1.15, 1.55].map((x, i) => <mesh key={i} position={[x, 3.25, -7]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.055, 0.055, 39, 8]} /><meshStandardMaterial color={i % 2 ? '#435158' : '#273b42'} metalness={0.75} roughness={0.32} />
    </mesh>)}
    {CONSOLES.map((consoleData) => <Console key={consoleData.id} data={consoleData} powered={powerRestored} />)}
    {powerRestored && <PowerMachinery />}

    {/* ========================================================================= */}
    {/* HOSPITAL & BIOLOGICAL RESEARCH ENVIRONMENTAL DETAILS AROUND THE 4 TERMINALS */}
    {/* ========================================================================= */}

    {/* 1. Near Archive Terminal (x=4.55, z=4.5) */}
    <HospitalBed position={[4.8, 0, 7.5]} rotation={[0, -Math.PI / 2, 0]} />
    <SkeletonProp position={[4.85, 0, 8.8]} rotation={[0, -0.6, 0]} slumped />
    <BloodDecayStain position={[4.6, 8.6]} scale={[1.3, 0.85]} />
    <ResearchDesk position={[4.8, 0, 1.8]} rotation={[0, -Math.PI / 2, 0]} />
    <FloorPapers position={[4.2, 0, 2.8]} />
    <HospitalWallSign position={[4.52, 2.35, 3.2]} rotation={[0, -Math.PI / 2, 0]} text="K-19 BIO ARCHIVE" code="PATIENT LOGS // CLASSIFIED" color="#59e0ae" />
    <HangingCables position={[4.2, 3.5, 4.5]} />
    <WallPipes position={[5.8, 2.8, 5]} length={6} />

    {/* 2. Near Power Control Terminal (x=-4.55, z=-2.4) */}
    <Wheelchair position={[-4.8, 0, 0.5]} rotation={[0, 0.8, 0]} />
    <DamagedVentilator position={[-4.8, 0, 1.8]} rotation={[0, Math.PI / 2, 0]} />
    <BloodDecayStain position={[-4.6, 0.6]} scale={[1.4, 0.9]} />
    <HazardBarrel position={[-4.8, 0, -4.6]} color="#233530" />
    <HazardBarrel position={[-4.2, 0, -4.9]} color="#382920" />
    <HospitalWallSign position={[-4.52, 2.35, -0.8]} rotation={[0, Math.PI / 2, 0]} text="POWER CONTROL BUS" code="BIO-ISOLATION FAIL-SAFE" color="#43c8e5" />
    <HangingCables position={[-4.2, 3.5, -2.4]} />

    {/* 3. Near Fuse Location & Security Zone (z=-5 to -7) */}
    <BloodDecayStain position={[3.2, -5.2]} scale={[1.5, 0.8]} rotation={0.4} />
    <FloorPapers position={[2.8, 0, -4.6]} />
    <OverturnedFurniture position={[4.8, 0, -3.8]} rotation={[0, -Math.PI / 2, 0]} />

    {/* 4. Near Security Terminal (x=4.55, z=-9.2) */}
    <CoveredBody position={[4.8, 0, -7.2]} rotation={[0, -Math.PI / 2, 0]} />
    <BloodDecayStain position={[4.6, -7.2]} scale={[1.6, 0.95]} />
    <OverturnedFurniture position={[4.8, 0, -11.5]} rotation={[0, -Math.PI / 2, 0]} />
    <MedicalCrashCart position={[4.8, 0, -12.4]} rotation={[0, -Math.PI / 2, 0]} />
    <HospitalWallSign position={[4.52, 2.35, -10.5]} rotation={[0, -Math.PI / 2, 0]} text="SECURITY TERMINAL" code="CONTAINMENT STATUS: LEVEL 4 CRITICAL" color="#58a9ff" />
    <HangingCables position={[4.2, 3.5, -9.2]} />

    {/* 5. Near Research Station Terminal (x=-4.55, z=-14.5) */}
    <ChemicalCabinet position={[-4.8, 0, -12.4]} rotation={[0, Math.PI / 2, 0]} glowColor="#32e88a" />
    <LabBench position={[-4.8, 0, -16.8]} rotation={[0, Math.PI / 2, 0]} />
    <SkeletonProp position={[-4.85, 0, -18.2]} rotation={[0, 0.5, 0]} slumped />
    <BloodDecayStain position={[-4.6, -18.0]} scale={[1.4, 0.9]} />
    <FloorPapers position={[-4.2, 0, -15.8]} />
    <HospitalWallSign position={[-4.52, 2.35, -13.2]} rotation={[0, Math.PI / 2, 0]} text="PALISADE BIO LAB 03" code="SPECIMEN ACOUSTIC ANOMALY" color="#fa665e" />
    <WallPipes position={[-5.8, 2.8, -14]} length={6} />

    {/* 6. Corridor approaching Restricted Sector 04 Bulkhead & Portal */}
    <HazardBarrel position={[-3.8, 0, -22.5]} color="#243834" />
    <HazardBarrel position={[3.8, 0, -22.8]} color="#382d24" />
    <HospitalBed position={[3.6, 0, -24.5]} rotation={[0, -0.3, 0]} tilted />
    <BloodDecayStain position={[0.2, -23.5]} scale={[2.2, 0.85]} rotation={0.2} />
    <BloodDecayStain position={[-0.4, -25.2]} scale={[1.8, 0.85]} rotation={-0.15} />
    <HangingCables position={[-1.2, 3.5, -23]} />
    <HangingCables position={[1.2, 3.5, -24]} />

    {/* crates, cable trays and a sealed bulkhead */}
    <Box position={[3.8, 0.48, -5.5]} scale={[1.25, 0.95, 1.3]} color="#30373a" />
    <Box position={[-3.8, 0.48, -11.6]} scale={[1.2, 0.95, 1.3]} color="#30373a" />
    <Box position={[-1.48, 1.72, -26.12]} scale={[0.2, 3.5, 0.44]} color="#647176" metalness={0.82} roughness={0.33} />
    <Box position={[1.48, 1.72, -26.12]} scale={[0.2, 3.5, 0.44]} color="#647176" metalness={0.82} roughness={0.33} />
    <Box position={[0, 3.38, -26.12]} scale={[3.16, 0.22, 0.44]} color="#647176" metalness={0.82} roughness={0.33} />
    <Box position={[0, 0.12, -26.12]} scale={[3.16, 0.22, 0.44]} color="#647176" metalness={0.82} roughness={0.33} />
    <pointLight position={[0, 2.8, -24]} color="#a94b42" intensity={1.2} distance={8} />
  </>
  }, [facilityWallMap, floorMap, powerRestored])

  return <>
    {staticEnvironment}
    <FacilityBulkheadState scannerCollected={scannerCollected} powerRestored={powerRestored} />
    {powerRestored && researchReviewed && !scannerCollected && <SensingMachine position={SCANNER_POSITION} />}
    {!fuseCollected && <MemoizedFusePickup position={FUSE_POSITION} />}
  </>
}

function FacilityBulkheadState({ scannerCollected, powerRestored }) {
  return <>
    <fog attach="fog" args={['#0c110e', 12, scannerCollected ? 80 : 42]} />
    {!scannerCollected && <Box position={[0, 1.7, -26.45]} scale={[3.4, 3.25, 0.15]} color="#303a3e" />}
    {!scannerCollected && <Box position={[0, 1.7, -26.34]} scale={[2.6, 2.5, 0.05]} color="#15252b" />}
    {!scannerCollected && <Box position={[0, 1.72, -26.27]} scale={[0.035, 2.38, 0.04]} color="#52636a" metalness={0.9} />}
    {!scannerCollected && <Box position={[0, 0.2, -26.28]} scale={[3.5, 0.18, 0.2]} color="#9f3438" />}
    {!scannerCollected && <Box position={[1.08, 1.72, -25.92]} scale={[0.075, 0.38, 0.08]} color="#adb8b6" metalness={0.86} />}
    {!scannerCollected && <Text position={[0, 2.34, -25.82]} fontSize={0.2} color="#d87669" anchorX="center">RESTRICTED · SECTOR 04</Text>}
    {scannerCollected && <group position={[0, 1.6, -26.62]}>
      <mesh><torusGeometry args={[1.18, 0.045, 8, 32]} /><meshStandardMaterial color="#3cb6c7" emissive="#27bed4" emissiveIntensity={powerRestored ? 2 : 0.8} transparent opacity={0.78} /></mesh>
      <pointLight color="#37b9d1" intensity={2.2} distance={6} />
    </group>}
  </>
}

// Tiny fragment helper keeps repeated wall rib JSX readable without adding a dependency.
function ReactFragment({ children }) { return <>{children}</> }

function Flashlight({ enabled }) {
  const { camera } = useThree()
  const lightRef = useRef()
  useEffect(() => {
    const light = new THREE.SpotLight('#f0f7ff', 0, 32, Math.PI / 6, 0.62, 1.15)
    light.position.set(0.08, -0.1, -0.05)
    light.target.position.set(0, -0.48, -1)
    light.castShadow = true
    light.shadow.mapSize.set(512, 512)
    camera.add(light, light.target)
    lightRef.current = light
    return () => { camera.remove(light, light.target); light.shadow.dispose() }
  }, [camera])
  useEffect(() => {
    if (lightRef.current) {
      lightRef.current.intensity = enabled ? 92 : 0
      lightRef.current.castShadow = enabled
    }
  }, [enabled])
  return null
}

function HeldScanner({ enabled }) {
  const { camera } = useThree(), tool = useRef()
  useEffect(() => {
    if (!enabled || !tool.current) return
    const heldTool = tool.current
    camera.add(heldTool)
    return () => camera.remove(heldTool)
  }, [camera, enabled])
  return enabled ? <group ref={tool} position={[0.34,-0.27,-0.62]} rotation={[0.12,-0.18,0.1]}>
    <mesh><boxGeometry args={[0.2,0.12,0.32]} /><meshStandardMaterial color="#293a40" metalness={0.78} roughness={0.35} /></mesh>
    <mesh position={[0,0.075,-0.08]}><sphereGeometry args={[0.065,12,12]} /><meshStandardMaterial color="#5be2ec" emissive="#39c5d3" emissiveIntensity={1.2} /></mesh>
    <mesh position={[0,0.07,-0.08]}><torusGeometry args={[0.105,0.012,6,16]} /><meshStandardMaterial color="#8bbdc0" metalness={0.8} /></mesh>
    <mesh position={[0,-0.08,0.13]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[0.045,0.06,0.1,10]} /><meshStandardMaterial color="#171f22" metalness={0.6} /></mesh>
  </group> : null
}

function HandgunView({ shotSequence, motionRef }) {
  const { camera } = useThree()
  const group = useRef(), muzzle = useRef(), flashLight = useRef()
  const lastShot = useRef(shotSequence), shotTime = useRef(-Infinity)
  const offset = useMemo(() => new THREE.Vector3(), [])
  const localRotation = useMemo(() => new THREE.Quaternion(), [])
  const localEuler = useMemo(() => new THREE.Euler(), [])
  useEffect(() => {
    if (!group.current) return
    const heldWeapon = group.current
    const previousCameraLayers = camera.layers.mask
    camera.layers.enable(VIEWMODEL_LAYER)
    heldWeapon.traverse((object) => object.layers.set(VIEWMODEL_LAYER))
    return () => { camera.layers.mask = previousCameraLayers }
  }, [camera])
  useFrame(({ clock }) => {
    if (!group.current) return
    if (lastShot.current !== shotSequence) { lastShot.current = shotSequence; shotTime.current = clock.elapsedTime }
    const elapsed = clock.elapsedTime - shotTime.current
    const recoil = elapsed >= 0 && elapsed < 0.28 ? (1 - elapsed / 0.28) ** 2 : 0
    const motion = motionRef.current
    const amount = THREE.MathUtils.clamp(motion.speed / 5, 0, 1)
    const sway = Math.sin(clock.elapsedTime * (motion.running ? 12 : 8)) * amount
    offset.set(0.29 + sway * 0.004, -0.13 + sway * (motion.running ? 0.006 : 0.003) + recoil * 0.02, -0.62 + recoil * 0.07)
    group.current.position.copy(camera.position).add(offset.applyQuaternion(camera.quaternion))
    localEuler.set(0.012 + recoil * 0.15, 0.12 + sway * 0.004, -0.018 - sway * 0.002)
    localRotation.setFromEuler(localEuler)
    group.current.quaternion.copy(camera.quaternion).multiply(localRotation)
    const flashOn = elapsed >= 0 && elapsed < 0.065
    if (muzzle.current) muzzle.current.visible = flashOn
    if (flashLight.current) flashLight.current.intensity = flashOn ? 2.2 : 0
  })
  return <group ref={group} renderOrder={10}>
    <HandgunModel muzzleRef={muzzle} firstPerson />
    <HandgunHand />
    <pointLight ref={flashLight} position={[0, 0.015, -0.34]} color="#ff9d52" intensity={0} distance={2.4} />
  </group>
}

const MemoizedHandgunView = memo(HandgunView)

function ShotImpact({ position, monsterHit }) {
  return <group position={position}>
    <mesh><octahedronGeometry args={[monsterHit ? 0.075 : 0.055, 0]} /><meshBasicMaterial color={monsterHit ? '#d8584f' : '#f0aa67'} /></mesh>
    <pointLight color={monsterHit ? '#d83b35' : '#f28b4c'} intensity={monsterHit ? 0.85 : 0.65} distance={1.1} decay={2} />
  </group>
}

function objectIsVisible(object) {
  for (let current = object; current; current = current.parent) if (!current.visible) return false
  return true
}

function belongsTo(object, root) {
  for (let current = object; current; current = current.parent) if (current === root) return true
  return false
}

function Player({ active, cutscenePlaying, onCutsceneComplete, escapePhase, flashlight, consoleOpen, scannerCollected, mazeUnlocked, handgunCollected, ammo, onWeaponShot, onMonsterHit, monsterObjectRef, interactables, onInteract, onNearConsole, onScan, onPlayerPosition, onSound, gameOver }) {
  const { camera, scene } = useThree()
  const keys = useRef(new Set())
  const velocity = useRef(new THREE.Vector3())
  const direction = useRef(new THREE.Vector3())
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const yaw = useRef(0)
  const pitch = useRef(0)
  const position = useRef(new THREE.Vector3(0, 1.65, 8.5))
  const nearby = useRef(null)
  const lastFootstepTime = useRef(0)
  const clockTime = useRef(0), reportTime = useRef(0)
  const cutsceneStartedAt = useRef(null), cutsceneCompleteSent = useRef(false), deathCameraPose = useRef(null), escapeCameraPose = useRef(null)
  const [shotSequence, setShotSequence] = useState(0)
  const [impact, setImpact] = useState(null)
  const impactTimer = useRef(null), impactId = useRef(0)
  const lastDryClick = useRef(-Infinity)
  const weaponMotion = useRef({ speed: 0, running: false })
  useEffect(() => {
    const down = (e) => {
      if (gameOver || escapePhase !== 'off') return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'].includes(e.code)) { e.preventDefault(); keys.current.add(e.code) }
      if (e.code === 'KeyE' && active && !consoleOpen && nearby.current && !e.repeat) { e.preventDefault(); onInteract(nearby.current) }
      if (e.code === 'KeyQ' && active && !consoleOpen && scannerCollected && mazeUnlocked && position.current.z < -27.1 && !e.repeat) { e.preventDefault(); onScan([position.current.x,position.current.z],clockTime.current) }
    }
    const up = (e) => keys.current.delete(e.code)
    const move = (e) => {
      if (document.pointerLockElement && !gameOver && escapePhase === 'off') {
        yaw.current -= e.movementX * 0.002
        pitch.current = THREE.MathUtils.clamp(pitch.current - e.movementY * 0.002, -1.35, 1.35)
      }
    }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('mousemove', move)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('mousemove', move) }
  }, [camera, active, consoleOpen, scannerCollected, mazeUnlocked, onInteract, onScan, gameOver, escapePhase])
  useEffect(() => {
    const shoot = (event) => {
      if (event.button !== 0 || !active || consoleOpen || gameOver || escapePhase !== 'off' || !handgunCollected || document.pointerLockElement !== document.body) return
      if (!onWeaponShot()) {
        if (clockTime.current - lastDryClick.current > 0.24) { lastDryClick.current = clockTime.current; onSound('emptyClick') }
        return
      }
      onSound('gunshot')
      setShotSequence((sequence) => sequence + 1)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const firstHit = raycaster.intersectObject(scene, true).find((hit) => hit.distance > 0.08 && objectIsVisible(hit.object) && !belongsTo(hit.object, camera))
      if (!firstHit) return
      const hitsMonster = Boolean(monsterObjectRef.current?.visible && belongsTo(firstHit.object, monsterObjectRef.current))
      const id = ++impactId.current
      setImpact({ id, position: firstHit.point.toArray(), monsterHit: hitsMonster })
      window.clearTimeout(impactTimer.current)
      impactTimer.current = window.setTimeout(() => setImpact((current) => current?.id === id ? null : current), 180)
      onSound(hitsMonster ? 'monsterImpact' : 'bulletImpact')
      if (hitsMonster) onMonsterHit()
    }
    window.addEventListener('mousedown', shoot)
    return () => window.removeEventListener('mousedown', shoot)
  }, [active, consoleOpen, gameOver, escapePhase, handgunCollected, ammo, camera, scene, onWeaponShot, onMonsterHit, monsterObjectRef, onSound])
  useEffect(() => () => window.clearTimeout(impactTimer.current), [])
  useFrame(({clock}, delta) => {
    clockTime.current = clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const input = keys.current
    if (cutscenePlaying) {
      input.clear()
      velocity.current.set(0, 0, 0)
      if (cutsceneStartedAt.current === null) cutsceneStartedAt.current = clock.elapsedTime
      const t = THREE.MathUtils.clamp((clock.elapsedTime - cutsceneStartedAt.current) / OPENING_CUTSCENE_DURATION, 0, 1)
      const rise = THREE.MathUtils.smoothstep(t, 0.08, 0.55)
      let yaw = 0, pitch = 0
      if (t < 0.32) yaw = -0.48 * THREE.MathUtils.smoothstep(t, 0, 0.32)
      else if (t < 0.62) yaw = -0.48 + 0.9 * THREE.MathUtils.smoothstep(t, 0.32, 0.62)
      else yaw = 0.42 * (1 - THREE.MathUtils.smoothstep(t, 0.62, 0.92))
      if (t < 0.48) pitch = -0.12 + 0.32 * THREE.MathUtils.smoothstep(t, 0, 0.48)
      else pitch = 0.2 * (1 - THREE.MathUtils.smoothstep(t, 0.48, 0.78))
      camera.position.set(position.current.x + Math.sin(t * Math.PI * 2) * 0.035, 0.48 + rise * (position.current.y - 0.48), position.current.z + Math.sin(t * Math.PI) * 0.045)
      camera.quaternion.setFromEuler(euler.current.set(pitch, yaw, 0, 'YXZ'))
      if (t >= 1 && !cutsceneCompleteSent.current) {
        cutsceneCompleteSent.current = true
        onCutsceneComplete()
      }
      return
    }
    cutsceneStartedAt.current = null
    cutsceneCompleteSent.current = false
    if (escapePhase === 'sequence') {
      input.clear()
      velocity.current.set(0, 0, 0)
      if (!escapeCameraPose.current) escapeCameraPose.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
      const elapsed = Math.max(0, performance.now() - ESCAPE_SEQUENCE.startedAt) / 1000
      const t = THREE.MathUtils.clamp(elapsed / (ESCAPE_SEQUENCE.durationMs / 1000), 0, 1)
      const pose = escapeCameraPose.current
      const look = (from, to) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(from, to, UP))
      const cabinPosition = new THREE.Vector3(0, 1.62, -75.9)
      const cabinLook = new THREE.Vector3(0, 1.58, -78.8)
      const cabinRotation = look(cabinPosition, cabinLook)
      if (t < 0.15) {
        const enter = THREE.MathUtils.smoothstep(t, 0.005, 0.15)
        camera.position.copy(pose.position).lerp(cabinPosition, enter)
        const faceExit = look(pose.position, new THREE.Vector3(0, 1.55, -72.5))
        camera.quaternion.copy(pose.quaternion).slerp(faceExit, THREE.MathUtils.smoothstep(t, 0, 0.045)).slerp(cabinRotation, THREE.MathUtils.smoothstep(t, 0.075, 0.15))
      } else if (t < 0.16) {
        camera.position.copy(cabinPosition)
        camera.quaternion.copy(cabinRotation)
      } else if (t < 0.535) {
        camera.position.copy(cabinPosition)
        camera.position.y += Math.sin(elapsed * 5.4) * 0.025
        camera.position.x += Math.sin(elapsed * 3.1) * 0.012
        camera.quaternion.copy(cabinRotation)
      } else {
        const runnerProgress = THREE.MathUtils.clamp((elapsed - 9) / 5.6, 0, 1)
        const runnerZ = -82 - runnerProgress * 16
        const leave = THREE.MathUtils.smoothstep(t, 0.535, 0.6)
        const run = THREE.MathUtils.smoothstep(elapsed, 8.8, 9.5)
        const bob = Math.sin(elapsed * 11) * 0.045 * run
        const followPosition = new THREE.Vector3(Math.sin(elapsed * 5.5) * 0.018 * run, 1.65 + Math.abs(bob), runnerZ)
        const followTarget = new THREE.Vector3(Math.sin(elapsed * 5.5) * 0.018 * run, 1.55 + Math.sin(elapsed * 11) * 0.012 * run, runnerZ - 8)
        const followRotation = look(followPosition, followTarget)
        camera.position.copy(cabinPosition).lerp(followPosition, leave)
        camera.quaternion.copy(cabinRotation).slerp(followRotation, leave)
      }
      return
    }
    escapeCameraPose.current = null
    if (gameOver) {
      if (!deathCameraPose.current) deathCameraPose.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
      const elapsed = Math.max(0, performance.now() - DEATH_CINEMATIC_STATE.startedAt) / 1000
      const t = THREE.MathUtils.clamp(elapsed / (DEATH_CINEMATIC_STATE.durationMs / 1000), 0, 1)
      const pose = deathCameraPose.current
      const monster = monsterObjectRef.current
      if (!monster) { camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion); return }
      monster.updateMatrixWorld(true)
      const target = monster.localToWorld(new THREE.Vector3(0, 2.35, 0.16))
      const endPosition = monster.localToWorld(new THREE.Vector3(0, 2.34, 0.72))
      const approach = THREE.MathUtils.smoothstep(t, 0.22, 0.9)
      const turn = THREE.MathUtils.smoothstep(t, 0.02, 0.3)
      camera.position.copy(pose.position).lerp(endPosition, approach)
      camera.position.y += 0.12 * Math.sin(Math.PI * THREE.MathUtils.smoothstep(t, 0.12, 0.78))
      const lookMatrix = new THREE.Matrix4().lookAt(camera.position, target, UP)
      const facing = new THREE.Quaternion().setFromRotationMatrix(lookMatrix)
      camera.quaternion.copy(pose.quaternion).slerp(facing, turn)
      return
    }
    deathCameraPose.current = null
    if (!active || consoleOpen || gameOver) { input.clear(); velocity.current.set(0, 0, 0) }
    const candidate = interactables.reduce((best,item)=>{
      const distance=Math.hypot(position.current.x-item.position[0],position.current.z-item.position[1])
      return distance<best.distance?{id:item.id,distance,range:item.range}:best
    },{id:null,distance:Infinity,range:0})
    const nextNearby = candidate.distance < candidate.range ? candidate.id : null
    if (nearby.current !== nextNearby) { nearby.current = nextNearby; onNearConsole(nextNearby) }
    const speed = input.has('ShiftLeft') ? 5.1 : 3.15
    const forward = Number(input.has('KeyW')) - Number(input.has('KeyS'))
    const side = Number(input.has('KeyD')) - Number(input.has('KeyA'))
    direction.current.set(side, 0, -forward).normalize().applyAxisAngle(UP, yaw.current)
    velocity.current.lerp(direction.current.multiplyScalar(speed), 1 - Math.exp(-12 * dt))
    const nextX = position.current.x + velocity.current.x * dt
    const nextZ = position.current.z + velocity.current.z * dt
    const previousX = position.current.x, previousZ = position.current.z
    // Corridor bounds plus solid equipment and bulkhead collision.
    const inMaze=position.current.z < -27.1
    const xLimit=inMaze?9.55:5.42
    if (Math.abs(nextX) < xLimit && !blocked(nextX, position.current.z, mazeUnlocked)) position.current.x = nextX
    const minZ=mazeUnlocked?-70.12:-25.7
    if (nextZ > minZ && nextZ < 12.15 && !blocked(position.current.x, nextZ, mazeUnlocked)) position.current.z = nextZ
    const moved = Math.hypot(position.current.x - previousX, position.current.z - previousZ)
    const running = input.has('ShiftLeft')
    weaponMotion.current.speed = active && !consoleOpen && !gameOver ? moved / Math.max(dt, 0.001) : 0
    weaponMotion.current.running = running
    if (active && !consoleOpen && !gameOver && moved > 0.012 && clock.elapsedTime - lastFootstepTime.current > (running ? 0.34 : 0.52)) {
      lastFootstepTime.current = clock.elapsedTime
      onSound(running ? 'playerRun' : 'playerWalk')
    }
    camera.position.copy(position.current)
    camera.quaternion.setFromEuler(euler.current.set(pitch.current, yaw.current, 0, 'YXZ'))
    reportTime.current+=dt
    if(reportTime.current>0.12){reportTime.current=0;onPlayerPosition([position.current.x,position.current.z],clock.elapsedTime)}
  })
  return <><Flashlight enabled={active && flashlight && !consoleOpen && !gameOver} /><HeldScanner enabled={scannerCollected} />{handgunCollected&&!gameOver&&escapePhase==='off'&&<MemoizedHandgunView shotSequence={shotSequence} motionRef={weaponMotion} />}{impact&&<ShotImpact key={impact.id} position={impact.position} monsterHit={impact.monsterHit} />}</>
}

const UP = new THREE.Vector3(0, 1, 0)
const ESCAPE_SEQUENCE = { startedAt: 0, durationMs: 16000 }

function blocked(x, z, mazeUnlocked) {
  if (z < -70.12) return true
  if (z < -27.1) {
    if (!mazeUnlocked || Math.abs(x) > 9.55) return true
    return MAZE_COLLIDERS.some((wall)=>(x > wall.x-wall.halfX-0.28 && x < wall.x+wall.halfX+0.28 && z > wall.z-wall.halfZ-0.28 && z < wall.z+wall.halfZ+0.28))
  }
  if (z < -25.7 && !mazeUnlocked) return true
  if (z < -26.5 && z > -27.3 && Math.abs(x) > 1.1) return true
  if (z > -27.1 && mazeUnlocked && z < -25.7 && Math.abs(x) > 1.42) return true
  const obstacles = [
    [3.8, -5.5, 0.82], [-3.8, -11.6, 0.82],
    [-4.55, -2.4, 0.92], [4.55, -9.2, 0.92], [-4.55, -14.5, 0.92], [4.55, 4.5, 0.92],
  ]
  return obstacles.some(([ox, oz, r]) => (x - ox) ** 2 + (z - oz) ** 2 < r ** 2)
}

function EscapeCinematicScene({ onSound }) {
  const { scene } = useThree()
  const exitDoorL = useRef(), exitDoorR = useRef(), entryDoorL = useRef(), entryDoorR = useRef(), liftDoorL = useRef(), liftDoorR = useRef(), cabinLamp = useRef()
  const runner = useRef(), runnerArmL = useRef(), runnerArmR = useRef(), runnerLegL = useRef(), runnerLegR = useRef()
  const audio = useRef({ motor: false, doors: false, motorStopped: false, surfaceDoors: false, nextStepAt: 0 })
  useEffect(() => {
    const previousFog = scene.fog
    scene.fog = new THREE.Fog('#121917', 18, 76)
    return () => { scene.fog = previousFog }
  }, [scene])
  useEffect(() => () => stopElevatorHum(), [])
  useFrame(({ clock }) => {
    const t = Math.max(0, (performance.now() - ESCAPE_SEQUENCE.startedAt) / 1000)
    const exitOpen = THREE.MathUtils.smoothstep(t, 0.08, 0.95)
    const cabinOpen = THREE.MathUtils.clamp(1 - THREE.MathUtils.smoothstep(t, 1.55, 2.35) + THREE.MathUtils.smoothstep(t, 7.65, 8.55), 0, 1)
    const entryOpen = 1 - THREE.MathUtils.smoothstep(t, 1.65, 2.45)
    if (exitDoorL.current) exitDoorL.current.position.x = -0.72 - exitOpen * 1.5
    if (exitDoorR.current) exitDoorR.current.position.x = 0.72 + exitOpen * 1.5
    if (entryDoorL.current) entryDoorL.current.position.x = -0.76 - entryOpen * 1.55
    if (entryDoorR.current) entryDoorR.current.position.x = 0.76 + entryOpen * 1.55
    if (liftDoorL.current) liftDoorL.current.position.x = -0.76 - cabinOpen * 1.55
    if (liftDoorR.current) liftDoorR.current.position.x = 0.76 + cabinOpen * 1.55
    if (cabinLamp.current) cabinLamp.current.intensity = 3.2 + (t > 2.5 && t < 8.6 ? Math.sin(clock.elapsedTime * 8) * 0.22 : 0)
    if (!audio.current.doors && t >= 1.55) { audio.current.doors = true; onSound('elevatorDoorClose') }
    if (!audio.current.motor && t >= 2.65) { audio.current.motor = true; onSound('elevatorMotorStart'); startElevatorHum() }
    if (!audio.current.motorStopped && t >= 7.15) { audio.current.motorStopped = true; stopElevatorHum(); onSound('elevatorMotorStop') }
    if (!audio.current.surfaceDoors && t >= 7.65) { audio.current.surfaceDoors = true; onSound('elevatorDoorOpen') }
    if (t >= 9.1 && t < 15.5 && t >= audio.current.nextStepAt) {
      audio.current.nextStepAt = t + 0.36
      onSound('playerRun')
    }
    if (runner.current) {
      const run = THREE.MathUtils.smoothstep(t, 8.75, 9.5)
      const runEnd = THREE.MathUtils.smoothstep(t, 14.6, 15.5)
      runner.current.visible = false
      runner.current.position.set(0, 0, -82 - THREE.MathUtils.clamp((t - 9) / 5.6, 0, 1) * 16)
      const gait = Math.sin(clock.elapsedTime * 11) * run * (1 - runEnd)
      runner.current.position.y = Math.abs(gait) * 0.035
      if (runnerArmL.current) runnerArmL.current.rotation.x = gait * 0.65
      if (runnerArmR.current) runnerArmR.current.rotation.x = -gait * 0.65
      if (runnerLegL.current) runnerLegL.current.rotation.x = -gait * 0.8
      if (runnerLegR.current) runnerLegR.current.rotation.x = gait * 0.8
    }
  })
  const trees = useMemo(() => Array.from({ length: 10 }, (_, index) => {
    const row = Math.floor(index / 2), side = index % 2 ? 1 : -1
    return [side * (4.2 + (row % 2) * 1.3 + (row % 3) * 0.18), -85 - row * 5 + side * 0.65, 0.82 + (row % 3) * 0.12, row, side]
  }), [])
  const forestLitter = useMemo(() => Array.from({ length: 14 }, (_, index) => {
    const side = index % 2 ? 1 : -1
    return [side * (2.4 + (index % 4) * 0.65), -84 - (index * 7 % 22), index % 3]
  }), [])
  return <>
    <ambientLight color="#9bb9a5" intensity={0.28} />
    <hemisphereLight color="#8ca9b6" groundColor="#11130f" intensity={0.65} />
    <directionalLight position={[-5, 10, -91]} target-position={[0, 0, -94]} color="#a8c2ad" intensity={0.7} castShadow shadow-mapSize-width={512} shadow-mapSize-height={512} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-camera-far={40} shadow-bias={-0.0003} />
    <group ref={exitDoorL} position={[-0.72, 1.55, -71.05]}><mesh><boxGeometry args={[1.43, 3.0, 0.18]} /><meshStandardMaterial color="#4b5557" metalness={0.82} roughness={0.32} /></mesh><mesh position={[0, 0, 0.096]}><boxGeometry args={[1.18, 2.68, 0.018]} /><meshStandardMaterial color="#354044" metalness={0.78} roughness={0.4} /></mesh><mesh position={[0.49, 0, 0.108]}><boxGeometry args={[0.025, 2.82, 0.012]} /><meshStandardMaterial color="#839090" metalness={0.9} roughness={0.25} /></mesh></group>
    <group ref={exitDoorR} position={[0.72, 1.55, -71.05]}><mesh><boxGeometry args={[1.43, 3.0, 0.18]} /><meshStandardMaterial color="#384447" metalness={0.82} roughness={0.32} /></mesh><mesh position={[0, 0, 0.096]}><boxGeometry args={[1.18, 2.68, 0.018]} /><meshStandardMaterial color="#2e393d" metalness={0.78} roughness={0.4} /></mesh><mesh position={[-0.49, 0, 0.108]}><boxGeometry args={[0.025, 2.82, 0.012]} /><meshStandardMaterial color="#839090" metalness={0.9} roughness={0.25} /></mesh></group>
    <group position={[0, 0, -76.5]}>
      <mesh position={[0, -0.08, 0]}><boxGeometry args={[3.3, 0.16, 4.8]} /><meshStandardMaterial color="#384347" metalness={0.72} roughness={0.43} /></mesh>
      <mesh position={[0, 3.3, 0]}><boxGeometry args={[3.3, 0.16, 4.8]} /><meshStandardMaterial color="#263236" metalness={0.68} roughness={0.5} /></mesh>
      <mesh position={[-1.58, 1.62, 0]}><boxGeometry args={[0.14, 3.2, 4.6]} /><meshStandardMaterial color="#364144" metalness={0.7} roughness={0.48} /></mesh>
      <mesh position={[1.58, 1.62, 0]}><boxGeometry args={[0.14, 3.2, 4.6]} /><meshStandardMaterial color="#364144" metalness={0.7} roughness={0.48} /></mesh>
      <mesh position={[-1.48, 1.62, 0]}><boxGeometry args={[0.035, 2.7, 3.95]} /><meshStandardMaterial color="#667174" metalness={0.82} roughness={0.35} /></mesh>
      <mesh position={[1.48, 1.62, 0]}><boxGeometry args={[0.035, 2.7, 3.95]} /><meshStandardMaterial color="#667174" metalness={0.82} roughness={0.35} /></mesh>
      <mesh position={[0, 0.025, 0]}><boxGeometry args={[2.95, 0.025, 4.2]} /><meshStandardMaterial color="#778184" metalness={0.8} roughness={0.38} /></mesh>
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => <mesh key={x} position={[x, 0.02, 0]}><boxGeometry args={[0.018, 0.012, 4.05]} /><meshStandardMaterial color="#1c2528" metalness={0.75} roughness={0.42} /></mesh>)}
      <mesh position={[0, 3.19, -2.29]}><boxGeometry args={[3.18, 0.15, 0.18]} /><meshStandardMaterial color="#657174" metalness={0.86} roughness={0.29} /></mesh>
      <mesh position={[-1.58, 1.62, -2.29]}><boxGeometry args={[0.14, 3.05, 0.18]} /><meshStandardMaterial color="#707b7d" metalness={0.86} roughness={0.29} /></mesh>
      <mesh position={[1.58, 1.62, -2.29]}><boxGeometry args={[0.14, 3.05, 0.18]} /><meshStandardMaterial color="#707b7d" metalness={0.86} roughness={0.29} /></mesh>
      <group ref={entryDoorL} position={[-0.76, 1.58, 2.3]}><mesh><boxGeometry args={[1.52, 3.08, 0.12]} /><meshStandardMaterial color="#505b5d" metalness={0.84} roughness={0.3} /></mesh><mesh position={[0, 0, -0.07]}><boxGeometry args={[1.25, 2.8, 0.016]} /><meshStandardMaterial color="#3c4749" metalness={0.82} roughness={0.35} /></mesh></group>
      <group ref={entryDoorR} position={[0.76, 1.58, 2.3]}><mesh><boxGeometry args={[1.52, 3.08, 0.12]} /><meshStandardMaterial color="#424e50" metalness={0.84} roughness={0.3} /></mesh><mesh position={[0, 0, -0.07]}><boxGeometry args={[1.25, 2.8, 0.016]} /><meshStandardMaterial color="#303a3d" metalness={0.82} roughness={0.35} /></mesh></group>
      <mesh position={[-1.43, 0.88, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 3.6, 8]} /><meshStandardMaterial color="#899395" metalness={0.92} roughness={0.22} /></mesh>
      <mesh position={[1.43, 0.88, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 3.6, 8]} /><meshStandardMaterial color="#899395" metalness={0.92} roughness={0.22} /></mesh>
      <mesh position={[1.48, 1.72, -1.15]}><boxGeometry args={[0.08, 0.78, 0.5]} /><meshStandardMaterial color="#1c2528" metalness={0.65} roughness={0.4} /></mesh>
      <mesh position={[1.425, 1.94, -1.28]}><boxGeometry args={[0.015, 0.06, 0.06]} /><meshStandardMaterial color="#8ce1b8" emissive="#4ab486" emissiveIntensity={1.2} /></mesh>
      <mesh position={[0, 3.08, -2.28]}><boxGeometry args={[2.9, 0.06, 0.04]} /><meshStandardMaterial color="#7fc4ad" emissive="#448b72" emissiveIntensity={0.8} /></mesh>
      <mesh position={[0, 3.13, 0]}><boxGeometry args={[1.45, 0.035, 1.7]} /><meshStandardMaterial color="#f1edda" emissive="#bec8a6" emissiveIntensity={1.25} roughness={0.32} /></mesh>
      <pointLight ref={cabinLamp} position={[0, 2.9, 0]} color="#d8e3d4" intensity={3.2} distance={8} />
      <group ref={liftDoorL} position={[-0.76, 1.58, -2.35]}><mesh><boxGeometry args={[1.52, 3.08, 0.12]} /><meshStandardMaterial color="#596365" metalness={0.86} roughness={0.28} /></mesh><mesh position={[0, 0, 0.07]}><boxGeometry args={[1.28, 2.78, 0.018]} /><meshStandardMaterial color="#3d484b" metalness={0.82} roughness={0.34} /></mesh><mesh position={[0.55, 0, 0.082]}><boxGeometry args={[0.025, 2.92, 0.012]} /><meshStandardMaterial color="#8b9798" metalness={0.95} roughness={0.2} /></mesh><mesh position={[0, 1.35, 0.085]}><boxGeometry args={[0.9, 0.018, 0.01]} /><meshStandardMaterial color="#849193" metalness={0.88} roughness={0.25} /></mesh></group>
      <group ref={liftDoorR} position={[0.76, 1.58, -2.35]}><mesh><boxGeometry args={[1.52, 3.08, 0.12]} /><meshStandardMaterial color="#465255" metalness={0.86} roughness={0.28} /></mesh><mesh position={[0, 0, 0.07]}><boxGeometry args={[1.28, 2.78, 0.018]} /><meshStandardMaterial color="#303a3d" metalness={0.82} roughness={0.34} /></mesh><mesh position={[-0.55, 0, 0.082]}><boxGeometry args={[0.025, 2.92, 0.012]} /><meshStandardMaterial color="#8b9798" metalness={0.95} roughness={0.2} /></mesh><mesh position={[0, 1.35, 0.085]}><boxGeometry args={[0.9, 0.018, 0.01]} /><meshStandardMaterial color="#849193" metalness={0.88} roughness={0.25} /></mesh></group>
    </group>
    <mesh position={[0, -0.16, -96]}><boxGeometry args={[48, 0.2, 58]} /><meshStandardMaterial color="#18201a" roughness={1} /></mesh>
    {trees.map(([x, z, scale, row, side], index) => <group key={index} position={[x, 0, z]} rotation={[0, row * 0.43 * side, 0]} scale={scale}>
      <mesh position={[0, 1.45, 0]} castShadow><cylinderGeometry args={[0.12, 0.31, 2.9 + (row % 2) * 0.45, 7]} /><meshStandardMaterial color={row % 2 ? '#393329' : '#302c23'} roughness={0.94} /></mesh>
      {[-1, 1].map((branch) => <mesh key={branch} position={[branch * 0.38, 1.85 + (row % 2) * 0.18, 0]} rotation={[0, 0, -branch * 0.82]} castShadow><cylinderGeometry args={[0.035, 0.085, 0.92, 5]} /><meshStandardMaterial color="#332e25" roughness={0.96} /></mesh>)}
      <mesh position={[0, 2.85, 0]} scale={[1.12, 0.92 + (row % 3) * 0.1, 0.95]} castShadow><icosahedronGeometry args={[0.88, 0]} /><meshStandardMaterial color={row % 2 ? '#1d2a20' : '#17231b'} roughness={1} /></mesh>
      <mesh position={[-0.42, 3.18, 0.05]} scale={[0.72, 0.77, 0.76]} castShadow><icosahedronGeometry args={[0.75, 0]} /><meshStandardMaterial color="#243126" roughness={1} /></mesh>
      <mesh position={[0.43, 3.25, -0.08]} scale={[0.72, 0.83, 0.78]} castShadow><icosahedronGeometry args={[0.74, 0]} /><meshStandardMaterial color="#1a281f" roughness={1} /></mesh>
      <mesh position={[0.02, 3.72, 0]} scale={[0.7, 0.82, 0.72]} castShadow><icosahedronGeometry args={[0.68, 0]} /><meshStandardMaterial color="#202b22" roughness={1} /></mesh>
    </group>)}
    {forestLitter.map(([x, z, type], index) => <mesh key={`litter-${index}`} position={[x, -0.035, z]} rotation={[0, index * 0.7, 0]} scale={[0.24 + type * 0.08, 0.055 + type * 0.018, 0.36 + type * 0.1]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={type === 1 ? '#34372a' : type === 2 ? '#26362b' : '#3c3328'} roughness={1} /></mesh>)}
    <group ref={runner} position={[0, 0, -82]} visible={false}>
      <mesh position={[0, 1.42, 0]}><capsuleGeometry args={[0.27, 0.72, 5, 8]} /><meshStandardMaterial color="#20272a" roughness={0.94} /></mesh>
      <mesh position={[0, 2.05, 0]}><sphereGeometry args={[0.19, 10, 8]} /><meshStandardMaterial color="#a18e7d" roughness={0.98} /></mesh>
      <group ref={runnerArmL} position={[-0.31, 1.72, 0]}><mesh position={[0, -0.35, 0]}><capsuleGeometry args={[0.09, 0.48, 4, 6]} /><meshStandardMaterial color="#283033" roughness={0.9} /></mesh></group>
      <group ref={runnerArmR} position={[0.31, 1.72, 0]}><mesh position={[0, -0.35, 0]}><capsuleGeometry args={[0.09, 0.48, 4, 6]} /><meshStandardMaterial color="#283033" roughness={0.9} /></mesh></group>
      <group ref={runnerLegL} position={[-0.13, 1.0, 0]}><mesh position={[0, -0.39, 0]}><capsuleGeometry args={[0.11, 0.54, 4, 6]} /><meshStandardMaterial color="#181e20" roughness={0.94} /></mesh></group>
      <group ref={runnerLegR} position={[0.13, 1.0, 0]}><mesh position={[0, -0.39, 0]}><capsuleGeometry args={[0.11, 0.54, 4, 6]} /><meshStandardMaterial color="#181e20" roughness={0.94} /></mesh></group>
    </group>
  </>
}

function GameScene({ started, flashlight, consoleOpen, cctvOpen, scannerCollected, mazeUnlocked, handgunCollected, ammo, onWeaponShot, onMonsterHit, monsterDead, monsterSpawnId, interactables, onInteract, onNearConsole, onScan, onPlayerPosition, onSound, progress, scannerReveal, lastNoise, onMonsterMode, gameOver, onAttack, escapePhase }) {
  const monsterObjectRef = useRef(null)
  return <Canvas shadows dpr={[1, 1.5]} camera={{ position: [0, 1.65, 8.5], fov: 72, near: 0.1, far: 80 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
    <MemoizedCCTVRenderPass mazeUnlocked={mazeUnlocked} />
    <Environment powerRestored={progress.powerRestored} fuseCollected={progress.fuseCollected} researchReviewed={progress.researchReviewed} scannerCollected={scannerCollected} />
    {progress.powerRestored && scannerCollected && <MazeLevel reveal={scannerReveal} mazeExited={progress.mazeExited} handgunCollected={handgunCollected} />}
    <Player active={started} escapePhase={escapePhase} flashlight={flashlight} consoleOpen={consoleOpen} scannerCollected={scannerCollected} mazeUnlocked={mazeUnlocked} handgunCollected={handgunCollected} ammo={ammo} onWeaponShot={onWeaponShot} onMonsterHit={onMonsterHit} monsterObjectRef={monsterObjectRef} interactables={interactables} onInteract={onInteract} onNearConsole={onNearConsole} onScan={onScan} onPlayerPosition={onPlayerPosition} onSound={onSound} gameOver={gameOver} />
    {escapePhase === 'sequence' && <EscapeCinematicScene onSound={onSound} />}
    {cctvOpen&&!mazeUnlocked&&<CCTVContainmentRoom />}
    {cctvOpen&&!mazeUnlocked&&<CCTVEnvironmentViews />}
    {cctvOpen&&!mazeUnlocked&&<MemoizedMonster dormantCctv noise={null} onMode={onMonsterMode} onSound={onSound} onAttack={onAttack} gameOver={false} />}
    {mazeUnlocked&&<MemoizedMonster key={monsterSpawnId} noise={lastNoise} onMode={onMonsterMode} onSound={onSound} onAttack={escapePhase==='off'?onAttack:undefined} gameOver={gameOver} dead={monsterDead} monsterObjectRef={monsterObjectRef} />}
  </Canvas>
}

const TERMINAL_TABS = [
  { id: 'overview', label: 'SYSTEM STATUS' }, { id: 'security', label: 'SECURITY' },
  { id: 'research', label: 'RESEARCH' }, { id: 'logs', label: 'LOG ARCHIVE' },
]
const LOGS = [
  { time: '03:17:42', title: 'UNSCHEDULED POWER DRAW', body: 'Power demand rose 340% in Containment Wing C. No active test was scheduled. The load signature resembles the chamber cycling itself.' },
  { time: '03:41:09', title: 'CAMERA FEED // SUBLEVEL 3', body: 'Motion captured in the sealed south corridor. Frame review shows no visible subject. Audio analysis returned a second heartbeat.' },
  { time: '04:06:31', title: 'DR. VOSS // PERSONAL NOTE', body: 'It repeats the words we say in the observation room. Tonight it used my voice before I entered the room.' },
]

const ARCHIVE_ENTRIES = [
  ['background','FACILITY BACKGROUND','K-19 was built to map structures hidden beneath the Atlantic shelf. Classified records reveal that its underground hospital concealed an illegal biological program. Patients were selected at random and used as research subjects without their knowledge or consent. Scientists sought to create a new organism, exposing human bodies to dangerous biological procedures beneath the cover of routine care.'],
  ['incident01','FAILED EXPERIMENTS // LOG 01','RECOVERED INCIDENT REPORT // 03:17 UTC. Most trials failed. Surviving patients suffered severe injuries; others died during procedures. Repeating acoustic signals were later detected beneath the containment wing, and continued after every transmitter was disconnected.'],
  ['incident02','SUBJECT 07 // CLASSIFIED REPORT','RESTRICTED BIOLOGICAL RECORD // 03:41 UTC. One trial produced a viable organism: Subject 07, formerly a human research subject. It is large, reddish, fleshy, and resembles the dead. Ocular response is absent or functionally useless; it cannot reliably identify a person by sight. Yet it turns toward unusual sonar radiation. When a pulse sounds, it moves toward its source. Do not test this again.'],
  ['incident03','PALISADE DEVICE // SECURITY WARNING','DEVICE RECORD // LOWER MAZE. The experimental sensing machine emits sonar radiation pulses. Returning echoes reveal hidden routes and nearby surroundings, allowing staff to navigate corridors absent from facility plans. Every pulse may disclose the operator’s location to Subject 07; repeated or unnecessary use increases the chance of attracting it. Use only when necessary. After the incident, communications failed, research staff disappeared, and K-19 was abandoned.'],
  ['voss','FINAL RECOVERED NOTE // ESCAPE PROTOCOL','HANDWRITTEN // AUTHOR UNCONFIRMED // 04:06 UTC. The only known route out runs through the lower research maze to its emergency exit. Use sonar carefully to reveal the maze. Avoid unnecessary signals. Move away from the last place you emitted a pulse. Never let Subject 07 catch you. Find the emergency exit and leave this facility. If the corridor answers before you send another pulse, it has already found you.'],
  ['securityCache','SECURITY OFFICER // PRIVATE NOTE','UNFILED HANDWRITING // CRYO-SPECIMEN STORAGE. After containment failed, I moved the service pistol out of the main security store. It is somewhere in the restricted lower wing, beyond the first ward turn, where the cryo-storage spur dead-ends. I hid it behind the last reagent cabinet. If you found this, do not waste a round unless you mean it.'],
]
const CAMERA_FEEDS = ['EAST CORRIDOR','CONTAINMENT WING','LOWER LABORATORY','MAINTENANCE CORRIDOR']
// Camera 01's initial view points directly at the dormant containment-room subject.
const CONTAINMENT_CCTV_CAMERA = 0
const CCTV_FEED_SIZE = { width: 480, height: 248 }
const CCTV_LAYER = 1
const CCTV_FEED_STATE = { active: false, cameraIndex: 0, pixels: new Uint8Array(CCTV_FEED_SIZE.width * CCTV_FEED_SIZE.height * 4), frame: 0 }
const CCTV_REVEAL_STATE = { phase: 'unseen', startedAt: 0, glitchSoundPlayed: false }
const CCTV_REVEAL_DURATION_MS = 7200
const CCTV_REVEAL_GLITCH_MS = 850
const DEATH_CINEMATIC_STATE = { startedAt: 0, durationMs: 6200, impactSoundPlayed: false }
const CCTV_CAMERAS = [
  [[-7.2, 2.7, -34], [0, 1, -45]], [[7.2, 2.7, -42], [0, 1, -53]],
  [[-7.2, 2.7, -58], [0, 1, -66]], [[7.2, 2.7, -65], [0, 1, -48]],
]
const CCTV_INITIAL_CAMERAS = [
  [[5.25, 2.6, -11.2], [4.05, 1.2, -15.5]],
  [[5.15, 2.65, -4.2], [0.45, 1.25, -10.2]],
  [[-5.05, 2.65, -11.3], [-1.45, 1.25, -15.4]],
  [[0.15, 2.65, -24.7], [0.15, 1.45, -22.25]],
]

function CCTVLabel({ position, size, heading, subtext, accent = '#a84236' }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 128
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#182124'; ctx.fillRect(0, 0, 512, 128)
    ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.strokeRect(4, 4, 504, 120)
    ctx.fillStyle = '#e2d9cc'; ctx.font = 'bold 29px monospace'; ctx.fillText(heading, 20, 53)
    ctx.fillStyle = accent; ctx.font = 'bold 21px monospace'; ctx.fillText(subtext, 20, 94)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [accent, heading, subtext])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={position}>
    <planeGeometry args={size} />
    <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
  </mesh>
}

function CCTVContainmentRoom() {
  const room = useRef()
  useEffect(() => {
    room.current?.traverse((object) => object.layers.set(CCTV_LAYER))
  }, [])
  return <group ref={room} position={[4.52, 0, -13.8]}>
    {/* These fittings exist only on the CCTV render layer; the player scene is unchanged. */}
    <Box position={[0, 1.72, -4.02]} scale={[3.35, 3.42, 0.16]} color="#20282a" metalness={0.72} roughness={0.65} />
    <Box position={[-1.62, 1.72, -1.92]} scale={[0.13, 3.42, 4.12]} color="#303a3c" metalness={0.82} />
    <Box position={[1.62, 1.72, -1.92]} scale={[0.13, 3.42, 4.12]} color="#303a3c" metalness={0.82} />
    <Box position={[0, 3.43, -1.92]} scale={[3.36, 0.16, 4.12]} color="#303a3c" metalness={0.82} />
    <Box position={[0, 0.04, -1.92]} scale={[3.36, 0.12, 4.12]} color="#303a3c" metalness={0.82} />
    <Box position={[0, 3.43, 0.015]} scale={[3.42, 0.2, 0.24]} color="#414b4c" metalness={0.84} />
    <Box position={[-1.63, 1.72, 0.015]} scale={[0.2, 3.48, 0.24]} color="#414b4c" metalness={0.84} />
    <Box position={[1.63, 1.72, 0.015]} scale={[0.2, 3.48, 0.24]} color="#414b4c" metalness={0.84} />
    <Box position={[0, 0.03, 0.015]} scale={[3.42, 0.2, 0.24]} color="#414b4c" metalness={0.84} />
    <pointLight position={[-0.25, 2.85, -1.75]} color="#f5f3e9" intensity={8} distance={9} decay={1.5} />
    <pointLight position={[0.55, 1.25, -2.35]} color="#f5f3e9" intensity={5} distance={7} decay={1.5} />
    <mesh position={[0, 1.73, 0.055]}>
      <boxGeometry args={[3.02, 3.18, 0.12]} />
      <meshPhysicalMaterial color="#d7e4e1" transparent opacity={0.1} roughness={0.12} metalness={0.04} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
    <Box position={[0, 3.69, 0.13]} scale={[1.95, 0.5, 0.07]} color="#101719" metalness={0.75} />
    <CCTVLabel position={[0, 3.69, 0.17]} size={[1.82, 0.4]} heading="BIOHAZARD // SUBJECT 07" subtext="CONTAINMENT SEALED" />
    {[-1.39, 1.39].map((x, i) => <mesh key={x} position={[x, 3.18, 0.145]}>
      <sphereGeometry args={[0.075, 8, 8]} />
      <meshBasicMaterial color={i ? '#b94135' : '#d29a45'} toneMapped={false} />
    </mesh>)}
  </group>
}

function CCTVEnvironmentViews() {
  const views = useRef()
  useEffect(() => { views.current?.traverse((object) => object.layers.set(CCTV_LAYER)) }, [])
  return <group ref={views}>
    {/* East corridor: original hospital props rendered only in CCTV. */}
    <pointLight position={[0.2, 3.15, -9.3]} color="#f1f0e8" intensity={8} distance={10} decay={1.5} />
    <Box position={[0.2, 3.45, -9.3]} scale={[1.55, 0.1, 0.3]} color="#202729" metalness={0.7} />
    <mesh position={[0.2, 3.38, -9.3]}><boxGeometry args={[1.3, 0.035, 0.12]} /><meshBasicMaterial color="#f1eee4" toneMapped={false} /></mesh>
    <HospitalBed position={[0.75, 0, -10.7]} rotation={[0, -0.16, 0]} tilted />
    <Wheelchair position={[-1.3, 0, -8.6]} rotation={[0, 0.35, 0]} />
    <MedicalCrashCart position={[1.8, 0, -13.3]} screenColor="#c9d8d1" />
    <FloorPapers position={[-0.9, 0, -11.4]} rotation={[0, 0.28, 0]} />

    {/* Biological research bay: original lab and specimen props. */}
    <pointLight position={[-1.8, 3.1, -14.4]} color="#f2f1e9" intensity={8} distance={9} decay={1.5} />
    <Box position={[-1.8, 3.42, -14.4]} scale={[1.5, 0.1, 0.28]} color="#202729" metalness={0.72} />
    <mesh position={[-1.8, 3.35, -14.4]}><boxGeometry args={[1.24, 0.035, 0.11]} /><meshBasicMaterial color="#f3f0e7" toneMapped={false} /></mesh>
    <LabBench position={[-1.55, 0, -15.1]} rotation={[0, -0.12, 0]} />
    <ChemicalCabinet position={[0.75, 0, -15.4]} rotation={[0, Math.PI, 0]} glowColor="#b5d08d" />
    <MedicalCrashCart position={[-2.95, 0, -16.5]} screenColor="#b7d4d4" />
    <HazardBarrel position={[1.8, 0, -16.6]} color="#3b4338" />
    <FloorPapers position={[-0.35, 0, -13.9]} rotation={[0, 0.7, 0]} />
    <CCTVLabel position={[-1.5, 2.62, -15.05]} size={[1.55, 0.36]} heading="PALISADE BIO LAB" subtext="SPECIMEN STORAGE" accent="#bd8e50" />

    {/* Restricted area: the door and warning details supplement the real bulkhead. */}
    <pointLight position={[0, 3.05, -22.3]} color="#f1eee5" intensity={6.5} distance={8} decay={1.6} />
    <pointLight position={[0, 2.6, -21.3]} color="#be342c" intensity={1.1} distance={5} decay={1.7} />
    <Box position={[0, 1.68, -22.45]} scale={[3.25, 3.5, 0.28]} color="#222b2e" metalness={0.82} />
    <Box position={[0, 1.68, -22.25]} scale={[2.62, 3.12, 0.12]} color="#3b4446" metalness={0.84} roughness={0.48} />
    <Box position={[0, 1.68, -22.17]} scale={[0.07, 3.0, 0.04]} color="#1b2224" metalness={0.76} />
    {[-0.76, 0.76].map((x) => <Box key={x} position={[x, 1.68, -22.16]} scale={[0.035, 2.75, 0.035]} color="#87918d" metalness={0.9} />)}
    <Box position={[1.72, 1.38, -21.96]} scale={[0.44, 0.9, 0.18]} color="#1a2426" metalness={0.78} />
    <Box position={[1.72, 1.58, -21.85]} scale={[0.25, 0.22, 0.025]} color="#831f1b" />
    <mesh position={[1.72, 1.58, -21.82]}><boxGeometry args={[0.16, 0.06, 0.012]} /><meshBasicMaterial color="#ef5b46" toneMapped={false} /></mesh>
    <CCTVLabel position={[0, 3.55, -22.14]} size={[2.05, 0.38]} heading="RESTRICTED // SECTOR 04" subtext="BIO-SECURITY LOCKDOWN" />
    <DamagedVentilator position={[2.55, 0, -20.8]} rotation={[0, -0.35, 0]} />
    <HangingCables position={[-2.1, 3.3, -20.7]} />
    <WallPipes position={[2.2, 3.05, -23.2]} rotation={[0, 0, 0]} length={3.8} />
    <HazardBarrel position={[-2.15, 0, -21.8]} color="#3b3029" />
  </group>
}

function CCTVRenderPass({ mazeUnlocked }) {
  const { gl, scene } = useThree()
  const target = useRef(), cameras = useRef([])
  useEffect(() => {
    target.current = new THREE.WebGLRenderTarget(CCTV_FEED_SIZE.width, CCTV_FEED_SIZE.height, { depthBuffer: true })
    cameras.current = CCTV_CAMERAS.map(([position, lookAt]) => {
      const camera = new THREE.PerspectiveCamera(72, CCTV_FEED_SIZE.width / CCTV_FEED_SIZE.height, 0.1, 80)
      camera.position.set(...position)
      camera.lookAt(...lookAt)
      camera.layers.enable(CCTV_LAYER)
      return camera
    })
    return () => { target.current?.dispose(); target.current = null }
  }, [])
  useFrame(() => {
    if (!CCTV_FEED_STATE.active || !target.current) return
    const previousTarget = gl.getRenderTarget()
    const camera = cameras.current[CCTV_FEED_STATE.cameraIndex]
    const cameraIndex = CCTV_FEED_STATE.cameraIndex
    const containmentView = !mazeUnlocked && cameraIndex === 0
    const [position, lookAt] = mazeUnlocked ? CCTV_CAMERAS[cameraIndex] : CCTV_INITIAL_CAMERAS[cameraIndex]
    camera.position.set(...position)
    camera.lookAt(...lookAt)
    const previousExposure = gl.toneMappingExposure
    try {
      if (containmentView) gl.toneMappingExposure = 1.3
      gl.setRenderTarget(target.current)
      gl.render(scene, camera)
      gl.readRenderTargetPixels(target.current, 0, 0, CCTV_FEED_SIZE.width, CCTV_FEED_SIZE.height, CCTV_FEED_STATE.pixels)
    } finally {
      gl.setRenderTarget(previousTarget)
      gl.toneMappingExposure = previousExposure
    }
    CCTV_FEED_STATE.frame++
  })
  return null
}

const MemoizedCCTVRenderPass = memo(CCTVRenderPass)

function ProgressTerminalFrame({ consoleData, progress, onClose, children }) {
  return <div className="terminal-scrim" role="dialog" aria-modal="true" aria-label={`${consoleData.name} interface`}><section className="terminal-window progression-terminal">
    <header className="terminal-head"><div className="terminal-brand"><span className="terminal-emblem">K</span><div><small>NORTH ATLANTIC RESEARCH DIVISION</small><strong>{consoleData.name}</strong></div></div><div className="terminal-status"><i /> {progress.powerRestored?'MAIN GRID ONLINE':'EMERGENCY BACKUP'} <span>NODE // {consoleData.kind}</span></div><button className="terminal-close" onClick={onClose} aria-label="Close terminal">×</button></header>
    <div className="terminal-content progression-content">{children}</div>
    <footer className="terminal-foot"><span>PF // K-19 FACILITY SYSTEMS</span><span>OBJECTIVE DATA STORED LOCALLY</span><button onClick={() => { playSfx('select'); onClose() }}>CLOSE TERMINAL &nbsp; ESC</button></footer>
  </section></div>
}

function PowerTerminalView({ consoleData, progress, onClose, onRestorePower }) {
  return <ProgressTerminalFrame consoleData={consoleData} progress={progress} onClose={onClose}>
    <div className="terminal-page-title"><div><small>FACILITY NETWORK &nbsp; / &nbsp; EMERGENCY POWER</small><h2>MAIN POWER CONTROL</h2></div><span className="live-clock">{progress.powerRestored?'GRID // STABLE':'AUXILIARY // 18%'}</span></div>
    <div className="power-console-grid"><div className="power-reactor"><div className={progress.powerRestored?'reactor-core online':'reactor-core'}><i/><i/><i/></div><span>REACTOR CORE</span></div><article className="data-panel power-message"><h3>{progress.powerRestored?'MAIN POWER RESTORED':'POWER BUS // OFFLINE'}</h3><p>{progress.powerRestored?'Primary distribution is stable. Lighting, terminal network and machinery are online.':'MAIN POWER OFFLINE — FUSE REQUIRED. Emergency backup is maintaining only life support and intermittent corridor lighting.'}</p>{!progress.fuseCollected&&<span className="inline-state">MISSING COMPONENT: CERAMIC FUSE K-19</span>}{progress.fuseCollected&&!progress.powerRestored&&<button className="terminal-action" onClick={onRestorePower}>INSTALL FUSE &amp; RESTORE POWER</button>}{progress.powerRestored&&<span className="inline-state green">ALL FACILITY SYSTEMS ONLINE</span>}</article></div>
    <div className="terminal-columns"><article className="data-panel"><h3>DISTRIBUTION BUS</h3><p><span>EMERGENCY BACKUP</span><b className="amber">ACTIVE</b></p><p><span>MAIN GRID</span><b className={progress.powerRestored?'green':'red'}>{progress.powerRestored?'ONLINE':'OFFLINE'}</b></p><p><span>FACILITY TERMINALS</span><b className={progress.powerRestored?'green':'amber'}>{progress.powerRestored?'4 / 4 ONLINE':'STANDBY'}</b></p></article><article className="data-panel"><h3>RESTORE SEQUENCE</h3><p><span>01 &nbsp; ISOLATE FAULT</span><b className="green">COMPLETE</b></p><p><span>02 &nbsp; REPLACE FUSE</span><b className={progress.fuseCollected?'green':'amber'}>{progress.fuseCollected?'READY':'REQUIRED'}</b></p><p><span>03 &nbsp; ENERGIZE GRID</span><b>{progress.powerRestored?'COMPLETE':'AWAITING'}</b></p></article></div>
  </ProgressTerminalFrame>
}

function ArchiveTerminalView({ consoleData, progress, onClose, onArchiveRead }) {
  const [entry,setEntry]=useState('background'),[viewed,setViewed]=useState(new Set(['background']))
  const selected=ARCHIVE_ENTRIES.find(([id])=>id===entry)??ARCHIVE_ENTRIES[0]
  const choose=(id)=>{playSfx('select');setEntry(id);setViewed((old)=>new Set([...old,id]))}
  return <ProgressTerminalFrame consoleData={consoleData} progress={progress} onClose={onClose}>
    <div className="terminal-page-title"><div><small>FACILITY ARCHIVE &nbsp; / &nbsp; RECOVERED RECORDS</small><h2>{selected[1]}</h2></div><span className="live-clock">{viewed.size} / {ARCHIVE_ENTRIES.length} READ</span></div>
    <div className="archive-layout"><nav className="archive-list">{ARCHIVE_ENTRIES.map(([id,label])=><button key={id} className={entry===id?'active':''} onClick={()=>choose(id)}><span>{viewed.has(id)?'✓':'·'}</span>{label}</button>)}</nav><article className="archive-page"><small>RECOVERED FILE &nbsp; // &nbsp; {entry.toUpperCase()}</small><h3>{selected[1]}</h3><p>{selected[2]}</p><div className="archive-stamp">K-19 &nbsp;·&nbsp; RESTRICTED &nbsp;·&nbsp; AUDIO/RESEARCH DIVISION</div></article></div>
    <button className="terminal-action" disabled={viewed.size<ARCHIVE_ENTRIES.length||progress.archiveRead} onClick={onArchiveRead}>{progress.archiveRead?'ARCHIVE INVESTIGATED':viewed.size<ARCHIVE_ENTRIES.length?'READ ALL FILES TO CONTINUE':'MARK ARCHIVE INVESTIGATED'}</button>
  </ProgressTerminalFrame>
}

function CCTVFeed({ camera, revealPhase, onSkipReveal, revealAllowed }) {
  const canvasRef = useRef()
  useEffect(() => {
    let request
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { width, height } = CCTV_FEED_SIZE
    const frame = ctx.createImageData(width, height)
    const rowBytes = width * 4
    const draw = () => {
      if (CCTV_FEED_STATE.frame) {
        for (let y = 0; y < height; y++) {
          const src = (height - 1 - y) * rowBytes
          frame.data.set(CCTV_FEED_STATE.pixels.subarray(src, src + rowBytes), y * rowBytes)
        }
        ctx.putImageData(frame, 0, 0)
      }
      request = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(request)
  }, [])
  const revealApplies = camera === 0 && revealAllowed && revealPhase !== 'unseen'
  const feedStateClass = revealApplies ? (revealPhase === 'lost' ? ' signal-lost' : revealPhase === 'glitch' ? ' reveal-glitch' : ' reveal-active') : ''
  return <div className={`camera-feed${feedStateClass}`}><div className="feed-meta"><span>CAM 0{camera+1} // {CAMERA_FEEDS[camera]}</span><span>{revealApplies&&revealPhase==='lost'?'NO SIGNAL':revealApplies?'INTERFERENCE':'LIVE'} <i/></span></div>
    <canvas ref={canvasRef} width={CCTV_FEED_SIZE.width} height={CCTV_FEED_SIZE.height} aria-label={`${CAMERA_FEEDS[camera]} live CCTV feed`} />
    {revealApplies&&revealPhase!=='lost'&&<div className={`cctv-reveal-overlay${revealPhase==='glitch'?' final-glitch':''}`}><span>CAMERA 01 // SIGNAL INSTABILITY</span><button onClick={onSkipReveal}>SKIP REVEAL</button></div>}
    {revealApplies&&revealPhase==='lost'&&<div className="cctv-signal-lost"><small>CAMERA 01 // CONNECTION INTERRUPTED</small><strong>SIGNAL LOST</strong><span>NO REMOTE RESPONSE</span></div>}
    <div className="feed-caption">{revealApplies&&revealPhase==='lost'?'CAMERA 01 // SIGNAL LOST':'LIVE FACILITY IMAGE // SUBJECT VISIBLE ONLY WITHIN CAMERA COVERAGE'}</div>
  </div>
}

function SecurityTerminalView({ consoleData, progress, onClose, onSecurityRead }) {
  const [camera,setCamera]=useState(0),[viewed,setViewed]=useState(new Set([0]))
  const [revealPhase,setRevealPhase]=useState(CCTV_REVEAL_STATE.phase)
  useEffect(() => { CCTV_FEED_STATE.active = true; CCTV_FEED_STATE.cameraIndex = camera; return () => { CCTV_FEED_STATE.active = false } }, [camera])
  useEffect(() => {
    if (revealPhase === 'revealing') {
      const elapsed = performance.now() - CCTV_REVEAL_STATE.startedAt
      const untilGlitch = Math.max(0, CCTV_REVEAL_DURATION_MS - CCTV_REVEAL_GLITCH_MS - elapsed)
      const timer = window.setTimeout(() => { CCTV_REVEAL_STATE.phase = 'glitch'; setRevealPhase('glitch') }, untilGlitch)
      return () => window.clearTimeout(timer)
    }
    if (revealPhase === 'glitch') {
      if (!CCTV_REVEAL_STATE.glitchSoundPlayed) { CCTV_REVEAL_STATE.glitchSoundPlayed = true; playSfx('electrical') }
      const elapsed = performance.now() - CCTV_REVEAL_STATE.startedAt
      const timer = window.setTimeout(() => { CCTV_REVEAL_STATE.phase = 'lost'; setRevealPhase('lost') }, Math.max(0, CCTV_REVEAL_DURATION_MS - elapsed))
      return () => window.clearTimeout(timer)
    }
  }, [revealPhase])
  const startReveal = () => {
    if (CCTV_REVEAL_STATE.phase !== 'unseen') return
    CCTV_REVEAL_STATE.phase = 'revealing'
    CCTV_REVEAL_STATE.startedAt = performance.now()
    setRevealPhase('revealing')
    playSfx('distant')
  }
  const skipReveal = () => {
    if (CCTV_REVEAL_STATE.phase === 'unseen' || CCTV_REVEAL_STATE.phase === 'lost') return
    CCTV_REVEAL_STATE.phase = 'lost'
    setRevealPhase('lost')
    if (!CCTV_REVEAL_STATE.glitchSoundPlayed) { CCTV_REVEAL_STATE.glitchSoundPlayed = true; playSfx('electrical') }
  }
  const choose=(index)=>{
    playSfx('select');setCamera(index);CCTV_FEED_STATE.cameraIndex=index;setViewed((old)=>new Set([...old,index]))
    if(index===CONTAINMENT_CCTV_CAMERA&&!progress.scannerCollected){
      // Let React commit the selected camera and the live feed render before the reveal begins.
      window.requestAnimationFrame(()=>{
        if(CCTV_FEED_STATE.active&&CCTV_FEED_STATE.cameraIndex===CONTAINMENT_CCTV_CAMERA)startReveal()
      })
    }
  }
  return <ProgressTerminalFrame consoleData={consoleData} progress={progress} onClose={onClose}>
    <div className="terminal-page-title"><div><small>SECURITY NETWORK &nbsp; / &nbsp; CAMERA ARRAY</small><h2>LIVE SURVEILLANCE</h2></div><span className="live-clock">{viewed.size} / 4 FEEDS CHECKED</span></div>
    <div className="security-layout"><div className="camera-list">{CAMERA_FEEDS.map((name,index)=><button key={name} className={camera===index?'active':''} onClick={()=>choose(index)}><small>CAM 0{index+1}</small><b>{name}</b><span>{viewed.has(index)?'VIEWED':'NO SIGNAL'}</span></button>)}</div><CCTVFeed camera={camera} revealPhase={revealPhase} onSkipReveal={skipReveal} revealAllowed={!progress.scannerCollected}/></div>
    <button className="terminal-action" disabled={viewed.size<4||progress.securityRead} onClick={onSecurityRead}>{progress.securityRead?'CAMERAS REVIEWED':viewed.size<4?'CHECK ALL CAMERA FEEDS':'MARK CAMERAS REVIEWED'}</button>
  </ProgressTerminalFrame>
}

function ResearchTerminalView({ consoleData, progress, onClose, onResearchRead }) {
  return <ProgressTerminalFrame consoleData={consoleData} progress={progress} onClose={onClose}>
    <div className="terminal-page-title"><div><small>PALISADE PROGRAM &nbsp; / &nbsp; EXPERIMENTAL SENSING</small><h2>RESEARCH STATION</h2></div><span className="live-clock">FILE // PAL-07</span></div>
    <div className="terminal-columns research-columns"><article className="data-panel"><h3>PALISADE // ACOUSTIC TOPOGRAPHY</h3><p className="research-copy">The PALISADE instrument maps spaces hidden behind solid surfaces by emitting a brief acoustic pulse and reading its return. Unmapped structures appear as route marks in the receiver display.</p><p className="research-copy">The pulse is not silent. Whatever answered us below can follow the signal back to its source. Use sparingly. Move after each reading.</p><div className="scanner-blueprint"><div className="blueprint-rings"/><span>PALISADE FIELD UNIT // MARK II</span></div><button className="terminal-action" disabled={progress.researchReviewed} onClick={onResearchRead}>{progress.researchReviewed?'FIELD UNIT RELEASED':'ACKNOWLEDGE NOTE & RELEASE DEVICE'}</button></article><article className="alert-panel"><div className="alert-header"><span>FIELD CAUTION</span><small>ACOUSTIC EMITTER</small></div><h3>Each pulse gives away your position.</h3><p>Collect the unit from the marked equipment station. Press Q only when you need to confirm the route ahead, then move away before the return signal fades.</p><span className="inline-state">RECEIVER RANGE: LOCAL / TEMPORARY</span></article></div>
  </ProgressTerminalFrame>
}

function Terminal({ consoleData, progress, onClose, onRestorePower, onArchiveRead, onSecurityRead, onResearchRead }) {
  const [tab, setTab] = useState('overview')
  const [lockdown, setLockdown] = useState(true)
  const [alarm, setAlarm] = useState(true)
  const [scan, setScan] = useState(false)
  const [logIndex, setLogIndex] = useState(0)
  const section = TERMINAL_TABS.find((item) => item.id === tab)
  if (consoleData.id === 'power') return <PowerTerminalView consoleData={consoleData} progress={progress} onClose={onClose} onRestorePower={onRestorePower} />
  if (consoleData.id === 'archive') return <ArchiveTerminalView consoleData={consoleData} progress={progress} onClose={onClose} onArchiveRead={onArchiveRead} />
  if (consoleData.id === 'security') return <SecurityTerminalView consoleData={consoleData} progress={progress} onClose={onClose} onSecurityRead={onSecurityRead} />
  if (consoleData.id === 'research') return <ResearchTerminalView consoleData={consoleData} progress={progress} onClose={onClose} onResearchRead={onResearchRead} />
  return <div className="terminal-scrim" role="dialog" aria-modal="true" aria-label={`${consoleData.name} interface`}>
    <section className="terminal-window">
      <header className="terminal-head"><div className="terminal-brand"><span className="terminal-emblem">K</span><div><small>NORTH ATLANTIC RESEARCH DIVISION</small><strong>{consoleData.name}</strong></div></div><div className="terminal-status"><i /> SECURE CONNECTION <span>NODE // {consoleData.kind}</span></div><button className="terminal-close" onClick={onClose} aria-label="Close terminal">×</button></header>
      <nav className="terminal-nav" aria-label="Terminal sections">{TERMINAL_TABS.map((item) => <button key={item.id} className={tab === item.id ? 'selected' : ''} onClick={() => { playSfx('select'); setTab(item.id) }}>{item.label}</button>)}</nav>
      <div className="terminal-content">
        <div className="terminal-page-title"><div><small>FACILITY NETWORK &nbsp; / &nbsp; {consoleData.kind}</small><h2>{section.label}</h2></div><span className="live-clock">LIVE // 05:43:18</span></div>
        {tab === 'overview' && <>
          <div className="status-grid">
            <article className="status-card"><small>REACTOR CORE</small><strong className="cyan">NOMINAL</strong><span>Output stable · 84.2 MW</span><div className="meter"><i style={{ width: '72%' }} /></div></article>
            <article className="status-card"><small>FACILITY POWER</small><strong>72<span>%</span></strong><span>Auxiliary reserves online</span><div className="meter"><i style={{ width: '72%' }} /></div></article>
            <article className="status-card"><small>SECURITY NETWORK</small><strong className={lockdown ? 'green' : 'amber'}>{lockdown ? 'LOCKED' : 'PARTIAL'}</strong><span>Perimeter {lockdown ? 'sealed' : 'access restricted'}</span></article>
            <article className="status-card"><small>ACTIVE ALERTS</small><strong className={alarm ? 'red' : 'green'}>{alarm ? '01' : '00'}</strong><span>{alarm ? 'Unknown signal detected' : 'Alerts acknowledged'}</span></article>
          </div>
          <div className="terminal-columns"><article className="data-panel"><h3>LABORATORY CONDITIONS</h3><p><span>SUBLEVEL</span><b>03 / EAST ANNEX</b></p><p><span>ATMOSPHERE</span><b>O₂ 20.4% &nbsp;·&nbsp; STABLE</b></p><p><span>CONTAINMENT</span><b className="amber">FLUCTUATING</b></p><p><span>LAST PERSONNEL CHECK</span><b>04:12 // NO RESPONSE</b></p></article>
            <article className="alert-panel"><div className="alert-header"><span>! &nbsp; PRIORITY ALERT</span><small>{alarm ? 'UNRESOLVED' : 'ACKNOWLEDGED'}</small></div><h3>{alarm ? 'Unidentified signal in the lower labs' : 'Alert acknowledged'}</h3><p>{alarm ? 'Acoustic monitoring has registered a repeating pattern beneath the containment wing. Source cannot be isolated.' : 'The signal is still being monitored. Acknowledgement has been written to the terminal audit log.'}</p><button className="terminal-action secondary" onClick={() => setAlarm(false)} disabled={!alarm}>{alarm ? 'ACKNOWLEDGE ALERT' : 'ALERT ACKNOWLEDGED'}</button></article></div>
        </>}
        {tab === 'security' && <div className="terminal-columns"><article className="data-panel"><h3>ACCESS CONTROL</h3><p><span>OUTER PERIMETER</span><b className="green">SECURED</b></p><p><span>SECTOR 04 DOORS</span><b className={lockdown ? 'amber' : 'green'}>{lockdown ? 'LOCKDOWN' : 'LOCAL CONTROL'}</b></p><p><span>CAMERA ARRAY</span><b>11 / 12 ONLINE</b></p><p><span>LAST BADGE READ</span><b>DR. E. VOSS // 04:12</b></p><button className="terminal-action" onClick={() => setLockdown((value) => !value)}>{lockdown ? 'RELEASE LOCAL LOCKDOWN' : 'REINSTATE LOCKDOWN'}</button></article><article className="alert-panel"><div className="alert-header"><span>SECURITY NOTICE</span><small>LEVEL 04</small></div><h3>Manual authorization required</h3><p>Remote release is disabled while the lower laboratory signal remains unclassified. Local control changes are logged to the facility audit trail.</p><span className="inline-state">CURRENT STATE: {lockdown ? 'LOCKDOWN ACTIVE' : 'LOCAL CONTROL ACTIVE'}</span></article></div>}
        {tab === 'research' && <div className="terminal-columns"><article className="data-panel"><h3>ACTIVE RESEARCH FILE</h3><p><span>PROJECT</span><b>PALISADE</b></p><p><span>SUBJECT</span><b>ACOUSTIC ANOMALY / 07</b></p><p><span>CONTAINMENT</span><b className="amber">UNVERIFIED</b></p><p><span>LAST ANALYSIS</span><b>{scan ? '05:43 // COMPLETE' : '04:02 // INCOMPLETE'}</b></p><button className="terminal-action" onClick={() => setScan(true)}>{scan ? 'SCAN COMPLETE' : 'RUN SAMPLE ANALYSIS'}</button></article><article className="alert-panel research-note"><div className="alert-header"><span>RESEARCH NOTE // DR. VOSS</span><small>RESTRICTED</small></div><h3>{scan ? 'Pattern match: human speech' : 'The signal is learning'}</h3><p>{scan ? 'Spectral comparison found 96.8% similarity to archived staff recordings. The remaining variance follows a rhythm inconsistent with known vocal anatomy.' : 'It began with echoes. Then words. In the last session it answered a question before we asked it. Suspend playback until the isolation array is repaired.'}</p><span className="inline-state">{scan ? 'SPECTRAL MATCH // 96.8%' : 'FILE PARTIALLY REDACTED'}</span></article></div>}
        {tab === 'logs' && <div className="log-layout"><div className="log-list">{LOGS.map((log, index) => <button key={log.time} className={logIndex === index ? 'active' : ''} onClick={() => setLogIndex(index)}><small>{log.time} UTC</small><strong>{log.title}</strong></button>)}</div><article className="log-detail"><small>RECOVERED AUDIO TRANSCRIPT &nbsp; // &nbsp; {LOGS[logIndex].time}</small><h3>{LOGS[logIndex].title}</h3><p>“{LOGS[logIndex].body}”</p><span className="inline-state">SOURCE: LOCAL BUFFER &nbsp;·&nbsp; INTEGRITY 88%</span></article></div>}
      </div>
      <footer className="terminal-foot"><span>PF // K-19 FACILITY SYSTEMS</span><span>CLASSIFICATION: RESTRICTED &nbsp;·&nbsp; SESSION {consoleData.id.toUpperCase()}</span><button onClick={onClose}>CLOSE TERMINAL &nbsp; ESC</button></footer>
    </section>
  </div>
}

function App() {
  const [started, setStarted] = useState(false)
  const [cutscenePhase, setCutscenePhase] = useState('off')
  const cutscenePhaseRef = useRef('off')
  const cutsceneTransitionTimer = useRef(null)
  const [soundEnabled] = useState(true)
  const [masterVolume] = useState(0.78)
  const [flashlight, setFlashlight] = useState(true)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [terminal, setTerminal] = useState(null)
  const [progress,setProgress]=useState({fuseCollected:false,powerRestored:false,archiveRead:false,securityRead:false,researchReviewed:false,scannerCollected:false,handgunCollected:false,mazeEntered:false,mazeExited:false})
  const progressRef = useRef(progress)
  progressRef.current = progress
  const [nearby,setNearby]=useState(null)
  const [toast,setToast]=useState('')
  const [scannerReveal,setScannerReveal]=useState(null)
  const [lastNoise,setLastNoise]=useState(null)
  const [monsterMode,setMonsterMode]=useState('quiet')
  const [health, setHealth] = useState(100)
  const [ammo, setAmmo] = useState(0)
  const ammoRef = useRef(0)
  const [monsterDead, setMonsterDead] = useState(false)
  const [monsterSpawnId, setMonsterSpawnId] = useState(0)
  const monsterHits = useRef(0), monsterDeadRef = useRef(false), respawnTimer = useRef(null)
  const [gameOver, setGameOver] = useState(false)
  const [deathCinematicDone, setDeathCinematicDone] = useState(false)
  const [escapePhase, setEscapePhase] = useState('off')
  const [restartKey, setRestartKey] = useState(0)
  const toastTimer=useRef(null),revealTimer=useRef(null),pulseId=useRef(0)
  const lockPointer = useCallback(() => document.body.requestPointerLock?.(), [])
  const play = useCallback(() => {
    window.clearTimeout(cutsceneTransitionTimer.current)
    applyAudioSettings(soundEnabled, masterVolume)
    startGameAudio()
    playSfx('alarm')
    setStarted(true)
    cutscenePhaseRef.current = 'playing'
    setCutscenePhase('playing')
  }, [soundEnabled, masterVolume])
  const finishOpeningCutscene = useCallback(() => {
    if (cutscenePhaseRef.current !== 'playing') return
    cutscenePhaseRef.current = 'blackout'
    setCutscenePhase('blackout')
  }, [])
  const showToast=useCallback((message)=>{setToast(message);window.clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>setToast(''),2600)},[])
  useEffect(()=>()=>{window.clearTimeout(toastTimer.current);window.clearTimeout(revealTimer.current)},[])
  useEffect(() => {
    if (cutscenePhase === 'blackout') {
      cutsceneTransitionTimer.current = window.setTimeout(() => {
        cutscenePhaseRef.current = 'release'
        setCutscenePhase('release')
      }, 620)
    } else if (cutscenePhase === 'release') {
      cutsceneTransitionTimer.current = window.setTimeout(() => {
        cutscenePhaseRef.current = 'off'
        setCutscenePhase('off')
        lockPointer()
      }, 850)
    }
    return () => window.clearTimeout(cutsceneTransitionTimer.current)
  }, [cutscenePhase, lockPointer])
  useEffect(()=>{
    if(!monsterDead||gameOver)return
    respawnTimer.current=window.setTimeout(()=>{
      if(!progress.scannerCollected||progress.mazeExited)return
      monsterHits.current=0;monsterDeadRef.current=false;setMonsterDead(false);setMonsterSpawnId((id)=>id+1)
    },3200)
    return ()=>window.clearTimeout(respawnTimer.current)
  },[monsterDead,gameOver,progress.scannerCollected,progress.mazeExited])
  useEffect(()=>()=>{stopFacilityAmbience();stopAudioVoices()},[])
  useEffect(()=>{if(gameOver){stopAudioVoices();playSfx('death');stopFacilityAmbience()}},[gameOver])
  useEffect(()=>{
    if(!gameOver)return
    const timer=window.setTimeout(()=>setDeathCinematicDone(true),DEATH_CINEMATIC_STATE.durationMs)
    return ()=>window.clearTimeout(timer)
  },[gameOver])
  useEffect(()=>{
    if(escapePhase!=='sequence')return
    const timer=window.setTimeout(()=>setEscapePhase('ending'),ESCAPE_SEQUENCE.durationMs)
    return ()=>window.clearTimeout(timer)
  },[escapePhase])
  useEffect(()=>{if(progress.mazeExited)stopFacilityAmbience()},[progress.mazeExited])
  useEffect(()=>{
    if(monsterMode!=='hunting last signal'||gameOver||escapePhase!=='off')return
    playSfx('monsterBreath')
    const breathTimer=window.setInterval(()=>playSfx('monsterBreath'),2600)
    return ()=>window.clearInterval(breathTimer)
  },[monsterMode,gameOver,escapePhase])
  const closeConsole = useCallback(() => { playSfx('select'); setTerminal(null) }, [])
  const interactables=useMemo(()=>{
    const list=[]
    const add=(id,name,position,range=2.35)=>list.push({id,name,position:position.length===3?[position[0],position[2]]:position,range})
    if(!progress.fuseCollected)add('fuse','MISSING FUSE',FUSE_POSITION,1.65)
    if(!progress.powerRestored)add('power','POWER CONTROL',CONSOLES.find((c)=>c.id==='power').position,2.4)
    if(progress.powerRestored&&!progress.archiveRead)add('archive','ARCHIVE TERMINAL',CONSOLES.find((c)=>c.id==='archive').position,2.4)
    if(progress.archiveRead&&(!progress.securityRead||progress.scannerCollected))add('security','SECURITY TERMINAL',CONSOLES.find((c)=>c.id==='security').position,2.4)
    if(progress.securityRead&&!progress.scannerCollected&&!progress.researchReviewed)add('research','RESEARCH STATION',CONSOLES.find((c)=>c.id==='research').position,2.4)
    if(progress.researchReviewed&&!progress.scannerCollected)add('scanner','PALISADE SENSING MACHINE',SCANNER_POSITION,1.75)
    if(progress.scannerCollected&&!progress.handgunCollected)add('handgun','SERVICE PISTOL',HANDGUN_POSITION,1.55)
    if(progress.mazeEntered&&!progress.mazeExited)add('exit','EMERGENCY EXIT',[0,-69.15],2.2)
    return list
  },[progress])
  const onInteract=useCallback((id)=>{
    if(gameOver)return
    const currentProgress = progressRef.current
    if(id==='fuse'&&!currentProgress.fuseCollected){setProgress((old)=>({...old,fuseCollected:true}));playSfx('fuse');playSfx('discovery');showToast('CERAMIC FUSE ACQUIRED');return}
    if(id==='scanner'&&currentProgress.researchReviewed&&!currentProgress.scannerCollected){setProgress((old)=>({...old,scannerCollected:true}));playSfx('discovery');showToast('SENSING DEVICE ACQUIRED — Q TO PULSE');return}
    if(id==='handgun'&&currentProgress.scannerCollected&&!currentProgress.handgunCollected){ammoRef.current=6;setAmmo(6);setProgress((old)=>({...old,handgunCollected:true}));playSfx('discovery');showToast('SERVICE PISTOL ACQUIRED — 6 ROUNDS');return}
    if(id==='exit'&&currentProgress.mazeEntered&&!currentProgress.mazeExited&&escapePhase==='off'){
      ESCAPE_SEQUENCE.startedAt=performance.now()
      setProgress((old)=>({...old,mazeExited:true}))
      setEscapePhase('sequence')
      playSfx('elevatorDoorOpen')
      document.exitPointerLock?.()
      return
    }
    const selected=CONSOLES.find((item)=>item.id===id)
    const canOpen=selected&&((id==='power'&&!currentProgress.powerRestored)||(id==='archive'&&currentProgress.powerRestored&&!currentProgress.archiveRead)||(id==='security'&&currentProgress.archiveRead&&(!currentProgress.securityRead||currentProgress.scannerCollected))||(id==='research'&&currentProgress.securityRead&&!currentProgress.researchReviewed))
    if(canOpen){setTerminal(selected);document.exitPointerLock?.();playSfx('terminal')}
  },[showToast,gameOver,escapePhase])
  const onWeaponShot=useCallback(()=>{
    if(ammoRef.current<=0)return false
    ammoRef.current-=1;setAmmo(ammoRef.current)
    return true
  },[])
  const onMonsterHit=useCallback(()=>{
    if(monsterDeadRef.current)return
    monsterHits.current+=1
    if(monsterHits.current>=3){monsterDeadRef.current=true;setMonsterDead(true);setMonsterMode('quiet')}
  },[])
  const updateNearby=useCallback((id)=>setNearby((current)=>current===id?current:id),[])
  const onRestorePower=useCallback(()=>{
    if(!progress.fuseCollected||progress.powerRestored)return
    setProgress((old)=>({...old,powerRestored:true}));playSfx('power');showToast('MAIN POWER RESTORED — SYSTEMS ONLINE')
  },[progress,showToast])
  const onArchiveRead=useCallback(()=>{if(!progress.powerRestored)return;setProgress((old)=>({...old,archiveRead:true}));playSfx('objective');showToast('ARCHIVE LOGS REVIEWED')},[progress,showToast])
  const onSecurityRead=useCallback(()=>{if(!progress.archiveRead)return;setProgress((old)=>({...old,securityRead:true}));playSfx('objective');showToast('CAMERA FEEDS REVIEWED')},[progress,showToast])
  const onResearchRead=useCallback(()=>{if(!progress.securityRead)return;setProgress((old)=>({...old,researchReviewed:true}));playSfx('objective');showToast('PALISADE FIELD UNIT RELEASED')},[progress,showToast])
  const onScan=useCallback((position,clockTime)=>{
    if(gameOver)return
    const id=++pulseId.current,noise={id,position,clockTime}
    const currentCell=[THREE.MathUtils.clamp(Math.round(position[0]/4+2),0,4),THREE.MathUtils.clamp(Math.round((-position[1]-29)/4),0,10)]
    const guidance=mazeGuidancePath(currentCell,MAZE_EXIT_CELL)
    setLastNoise(noise);setScannerReveal({id,position,guidance,noise});playSfx('scanner');showToast('SONAR PULSE — SIGNAL DETECTED')
    window.clearTimeout(revealTimer.current);revealTimer.current=window.setTimeout(()=>setScannerReveal((current)=>current?.id===id?null:current),2700)
  },[showToast,gameOver])
  const onPlayerPosition=useCallback((position,clockTime)=>{
    const currentProgress = progressRef.current
    if(position[1]<-27.15&&currentProgress.scannerCollected&&!currentProgress.mazeEntered){
      setProgress((old)=>({...old,mazeEntered:true}));
      playSfx('objective')
      showToast('LOWER MAZE ENTERED — FIND THE EXIT');
      const id=++pulseId.current,noise={id,position:[position[0],position[1]],clockTime:clockTime??0}
      setLastNoise(noise)
    }
  },[showToast])
  const onMonsterMode=useCallback((mode)=>setMonsterMode((old)=>old===mode?old:mode),[])
  const onMonsterAttack=useCallback(()=>{
    setHealth((prev)=>{
      if(prev<=0)return 0
      const next=Math.max(0,prev-20)
      if(next<=0){
        if(!DEATH_CINEMATIC_STATE.startedAt){DEATH_CINEMATIC_STATE.startedAt=performance.now();DEATH_CINEMATIC_STATE.impactSoundPlayed=false}
        setGameOver(true)
        document.exitPointerLock?.()
      }
      return next
    })
  },[])
  const handleRestart=useCallback(()=>{
    stopAudioVoices();stopFacilityAmbience();startGameAudio()
    CCTV_REVEAL_STATE.phase='unseen';CCTV_REVEAL_STATE.startedAt=0;CCTV_REVEAL_STATE.glitchSoundPlayed=false
    DEATH_CINEMATIC_STATE.startedAt=0;DEATH_CINEMATIC_STATE.impactSoundPlayed=false;setDeathCinematicDone(false)
    window.clearTimeout(cutsceneTransitionTimer.current)
    cutscenePhaseRef.current='off';setCutscenePhase('off')
    setHealth(100)
    ammoRef.current=0;setAmmo(0);monsterHits.current=0;monsterDeadRef.current=false;setMonsterDead(false);window.clearTimeout(respawnTimer.current)
    setGameOver(false)
    setProgress({fuseCollected:false,powerRestored:false,archiveRead:false,securityRead:false,researchReviewed:false,scannerCollected:false,handgunCollected:false,mazeEntered:false,mazeExited:false})
    setLastNoise(null)
    setScannerReveal(null)
    setMonsterMode('quiet')
    setTerminal(null)
    setToast('')
    setRestartKey((k)=>k+1)
    setStarted(true)
    lockPointer()
  },[lockPointer])
  const mazeUnlocked=progress.scannerCollected
  const objective=progress.mazeExited?'ESCAPE COMPLETE':!progress.fuseCollected?'FIND THE MISSING FUSE':!progress.powerRestored?'RESTORE MAIN POWER':!progress.archiveRead?'INVESTIGATE THE ARCHIVE':!progress.securityRead?'CHECK THE SECURITY CAMERAS':!progress.scannerCollected?'COLLECT THE SENSING MACHINE':!progress.mazeEntered?'ENTER THE LOWER MAZE':'FIND THE EXIT'
  const interactName=interactables.find((item)=>item.id===nearby)?.name
  useEffect(() => {
    const onKey = (e) => {
      if (gameOver || cutscenePhase !== 'off' || escapePhase !== 'off') return
      if (terminal && e.code === 'Escape') { e.preventDefault(); closeConsole(); return }
      if (e.code === 'KeyF' && started && !terminal && !e.repeat) setFlashlight((value) => { playSfx(value ? 'flashlightOff' : 'flashlightOn'); return !value })
    }
    const onLock = () => {
      if (gameOver) { setPointerLocked(false); return }
      setPointerLocked(document.pointerLockElement === document.body)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerlockchange', onLock)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerlockchange', onLock) }
  }, [started, terminal, closeConsole, gameOver, cutscenePhase, escapePhase])
  return <main className="game-shell">
    <GameScene key={restartKey} started={started&&!progress.mazeExited&&cutscenePhase==='off'} cutscenePlaying={cutscenePhase==='playing'} escapePhase={escapePhase} onCutsceneComplete={finishOpeningCutscene} flashlight={flashlight} consoleOpen={Boolean(terminal)} cctvOpen={terminal?.id==='security'} scannerCollected={progress.scannerCollected} mazeUnlocked={mazeUnlocked} handgunCollected={progress.handgunCollected} ammo={ammo} onWeaponShot={onWeaponShot} onMonsterHit={onMonsterHit} monsterDead={monsterDead} monsterSpawnId={monsterSpawnId} interactables={interactables} onInteract={onInteract} onNearConsole={updateNearby} onScan={onScan} onPlayerPosition={onPlayerPosition} onSound={playSfx} progress={progress} scannerReveal={scannerReveal} lastNoise={lastNoise} onMonsterMode={onMonsterMode} gameOver={gameOver} onAttack={onMonsterAttack} />
    {!started ? <div className="intro-screen">
      <div className="intro-atmosphere" aria-hidden="true"><i/><i/><i/><i/><i/><span/></div>
      <div className="intro-mark"><span>PF // FIELD ARCHIVE 07</span><i /></div>
      <div className="intro-copy"><p className="eyebrow">A PIXELFORGE 2026 EXPERIENCE</p><h1 className="intro-title"><span className="title-main">ECHOES</span><span className="title-connector">OF THE</span><span className="title-main">UNKNOWN</span></h1>
        <p className="intro-sub">Some signals should never be answered.</p>
        <button className="play-button" onClick={play}><span>ENTER THE FACILITY</span><b>→</b></button>
        <p className="intro-foot"><span className="mission-chapter">CHAPTER 01 <i>—</i> THE DESCENT</span><span className="mission-location">05:43 AM <i>//</i> SITE K-19</span></p>
      </div>
      <div className="intro-side">NORTH ATLANTIC RESEARCH DIVISION <b>—</b> CLEARANCE LEVEL 04</div>
    </div> : <div className={`hud${gameOver?' death-sequence-active':''}${escapePhase==='sequence'?' escape-sequence-active':''}`}>
      <div className="hud-top"><span className="rec-dot" /> <span>REC</span><span className="hud-divider" />SITE K-19 <span className="hud-coord">SECTOR 04 // SUBLEVEL 3</span></div>
      <div className="objective-hud"><small>CURRENT OBJECTIVE</small><strong>{objective}</strong></div>
      <div className="health-hud">
        <div className="health-meta">
          <small>VITAL SIGNS</small>
          <strong>{Math.max(0, health)}/100</strong>
        </div>
        <div className="health-bar-track">
          <div
            className="health-bar-fill"
            style={{
              width: `${Math.max(0, health)}%`,
              backgroundColor: health > 50 ? '#54dba6' : health > 20 ? '#e0b66d' : '#e16c66',
              boxShadow: `0 0 8px ${health > 50 ? '#54dba6' : health > 20 ? '#e0b66d' : '#e16c66'}`
            }}
          />
        </div>
      </div>
      <div className="reticle" />
      {interactName && !terminal && pointerLocked && !gameOver && <div className="interact-prompt"><span>E</span><b>PRESS E TO INTERACT</b><small>{interactName}</small></div>}
      {progress.scannerCollected&&<div className="scanner-hud"><i/>PALISADE FIELD UNIT <b>Q&nbsp; PULSE</b></div>}
      {progress.handgunCollected&&<div className="ammo-hud"><small>AMMUNITION</small><strong>AMMO: {ammo} / 6</strong></div>}
      {monsterMode!=='quiet'&&progress.mazeEntered&&<div className="threat-hud">ACOUSTIC TRACE // {monsterMode.toUpperCase()}</div>}
      {toast&&<div className="game-toast">{toast}</div>}
      <div className="hud-bottom"><div className="flash-status"><span className={flashlight ? 'flash-icon on' : 'flash-icon'}>◉</span><div><small>FLASHLIGHT</small><strong>{flashlight ? 'ON' : 'OFF'} <em>· F</em></strong></div><div className="battery"><i style={{ width: flashlight ? '76%' : '76%' }} /></div></div>
        <div className="control-hint"><span><b>W A S D</b> MOVE</span><span><b>SHIFT</b> RUN</span><span><b>F</b> LIGHT</span><span><b>E</b> INTERACT</span>{progress.scannerCollected&&<span><b>Q</b> PULSE</span>}<span><b>ESC</b> RELEASE</span></div>
      </div>
      {!pointerLocked && !gameOver && cutscenePhase === 'off' && <button className="resume-hint" onClick={lockPointer}>CLICK TO RESUME</button>}
    </div>}
    {cutscenePhase !== 'off' && <div className={`opening-cutscene${cutscenePhase==='blackout'?' is-blackout':cutscenePhase==='release'?' is-release':''}`} aria-label="Opening cinematic">
      <p className="opening-cutscene-subtitle">Where... am I?</p>
      {cutscenePhase==='playing' && <button className="cutscene-skip" onClick={finishOpeningCutscene}>SKIP &nbsp; <span>››</span></button>}
    </div>}
    {terminal && !gameOver && <Terminal key={terminal.id} consoleData={terminal} progress={progress} onClose={closeConsole} onRestorePower={onRestorePower} onArchiveRead={onArchiveRead} onSecurityRead={onSecurityRead} onResearchRead={onResearchRead} />}
    {escapePhase==='sequence'&&<div className="escape-cinematic-fade" aria-hidden="true" />}
    {escapePhase==='ending'&&<div className="victory-overlay" role="dialog" aria-modal="true" aria-label="You escaped"><div className="victory-panel"><small>K-19 // SURFACE BREACH CONFIRMED</small><h2>YOU ESCAPED</h2><p>You survived the unknown... but some secrets never stay buried.</p><button className="play-button" onClick={()=>window.location.reload()}><span>RETURN TO TITLE</span><b>↻</b></button></div></div>}
    {gameOver && !deathCinematicDone && <div className="death-cinematic-fade" aria-hidden="true" />}
    {gameOver && deathCinematicDone && <div className="game-over-overlay" role="dialog" aria-modal="true" aria-label="Game Over">
      <div className="game-over-panel">
        <small className="game-over-sub">K-19 // CRITICAL TERMINATION</small>
        <h2 className="game-over-title">YOU DIDN'T SURVIVE</h2>
        <p className="game-over-message"><span>YOUR SIGNAL WAS HEARD.</span><span>YOUR LOCATION WAS REVEALED.</span><span>THE FACILITY HAS CLAIMED ANOTHER SUBJECT.</span></p>
        <button className="play-button restart-button" onClick={handleRestart}><span>RESTART</span><b>↻</b></button>
        <button className="play-button restart-button main-menu-button" onClick={()=>window.location.reload()}><span>MAIN MENU</span><b>⌂</b></button>
      </div>
    </div>}
    <div className="vignette" />
  </main>
}

export default App
