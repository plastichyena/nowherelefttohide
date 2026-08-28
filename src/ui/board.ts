import Phaser from 'phaser';
import { getHordeEntrance } from '../core/map';
import { getSectorBranchIds } from '../core/supply';
import type { CardinalDirection, GameState, HexCoord } from '../core/types';

export interface BoardRenderState {
  state: Readonly<GameState>;
  selectedPosition?: HexCoord | null;
  selectedUnitId?: string | null;
  legalDestinations?: readonly HexCoord[];
  attackTargetIds?: readonly string[];
  pendingPath?: readonly HexCoord[];
  hordeDirection?: CardinalDirection | null;
  supplyOverlay?: boolean;
  suppliedTileKeys?: readonly string[];
  branchRadii?: readonly { branchId: string; radius: number }[];
  checkpointPreviewPositions?: readonly HexCoord[];
  checkpointPreviewSelected?: HexCoord | null;
  blockedZombieIds?: readonly string[];
}

export interface BoardCallbacks {
  onTileTap(position: HexCoord): void;
}

type LabelEntity = 'facility' | 'checkpoint' | 'unit';
type LabelPurpose = 'icon' | 'infection' | 'status' | 'detail';

const HEX_SIZE = 30;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT = HEX_SIZE * 2;
const WORLD_PADDING = 120;

function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Phaser-only adapter. It owns no game rules: all clicks are converted to a
 * coordinate and handed to the DOM/controller, which emits GameAction to the
 * engine. The scene can therefore be replaced by a headless test without
 * changing the core.
 */
export class HexBoardScene extends Phaser.Scene {
  private readonly callbacks: BoardCallbacks;
  private graphics!: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly activeLabelKeys = new Set<string>();
  private current: BoardRenderState | null = null;
  private dragStart: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private pointerDown: { x: number; y: number; screenX: number; screenY: number } | null = null;
  private readonly pinchPointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private pinchZoom = 1;
  private cameraInitialized = false;
  private readonly zoomMin = 0.55;
  private readonly zoomMax = 2.2;

  constructor(callbacks: BoardCallbacks) {
    super({ key: 'hex-board' });
    this.callbacks = callbacks;
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.cameras.main.setBackgroundColor('#071019');
    this.events.once('shutdown', this.handleShutdown, this);
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerout', this.handlePointerUp, this);
    this.input.on('wheel', this.handleWheel, this);
    this.scale.on('resize', this.handleResize, this);
    this.handleResize(this.scale.gameSize);
    if (this.current) this.draw(this.current);
  }

  updateState(next: BoardRenderState): void {
    this.current = next;
    if (this.graphics) this.draw(next);
  }

  private handleResize(size: { width: number; height: number }): void {
    if (!this.cameras.main) return;
    if (this.current) {
      this.configureCamera(this.current.state, !this.cameraInitialized, size);
    }
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const point = { x: pointer.x, y: pointer.y };
    this.pinchPointers.set(pointer.id, point);
    if (this.pinchPointers.size >= 2) {
      const points = [...this.pinchPointers.values()];
      this.pinchDistance = distance(points[0]!, points[1]!);
      this.pinchZoom = this.cameras.main.zoom;
      this.dragStart = null;
      this.pointerDown = null;
      return;
    }
    this.pointerDown = { x: pointer.x, y: pointer.y, screenX: pointer.x, screenY: pointer.y };
    this.dragStart = {
      x: pointer.x,
      y: pointer.y,
      scrollX: this.cameras.main.scrollX,
      scrollY: this.cameras.main.scrollY,
    };
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.pinchPointers.has(pointer.id)) this.pinchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.pinchPointers.size >= 2 && this.pinchDistance > 0) {
      const points = [...this.pinchPointers.values()];
      const nextDistance = distance(points[0]!, points[1]!);
      this.setZoom(this.pinchZoom * (nextDistance / this.pinchDistance), pointer.x, pointer.y);
      return;
    }
    if (!this.dragStart || !pointer.isDown) return;
    const zoom = this.cameras.main.zoom;
    this.cameras.main.scrollX = this.dragStart.scrollX - (pointer.x - this.dragStart.x) / zoom;
    this.cameras.main.scrollY = this.dragStart.scrollY - (pointer.y - this.dragStart.y) / zoom;
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const wasPinching = this.pinchPointers.size >= 2;
    this.pinchPointers.delete(pointer.id);
    if (this.pinchPointers.size < 2) this.pinchDistance = 0;
    if (wasPinching || !this.pointerDown) {
      if (this.pinchPointers.size === 0) {
        this.dragStart = null;
        this.pointerDown = null;
      }
      return;
    }
    const moved = Math.hypot(pointer.x - this.pointerDown.x, pointer.y - this.pointerDown.y);
    const position = this.worldToHex(pointer.x, pointer.y);
    this.dragStart = null;
    this.pointerDown = null;
    if (moved < 12 && position) this.callbacks.onTileTap(position);
  }

  private handleWheel(pointer: Phaser.Input.Pointer, _gameObjects: unknown, deltaX: number, deltaY: number): void {
    const factor = deltaY > 0 ? 0.9 : 1.1;
    this.setZoom(this.cameras.main.zoom * factor, pointer.x, pointer.y);
    void deltaX;
  }

  private setZoom(next: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(screenX, screenY);
    camera.setZoom(Phaser.Math.Clamp(next, this.zoomMin, this.zoomMax));
    const after = camera.getWorldPoint(screenX, screenY);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
    if (this.current) this.configureCamera(this.current.state, false, this.scale.gameSize);
  }

  private configureCamera(
    state: Readonly<GameState>,
    center: boolean,
    size: { width: number; height: number },
  ): void {
    const camera = this.cameras.main;
    const bounds = this.mapBounds(state);
    camera.setBounds(
      0,
      0,
      Math.max(bounds.width, size.width / camera.zoom),
      Math.max(bounds.height, size.height / camera.zoom),
    );
    if (center) {
      const capital = state.facilities.find((facility) => facility.type === 'capital');
      const focus = capital ? this.hexToWorld(state, capital.position) : bounds.center;
      camera.centerOn(focus.x, focus.y);
      this.cameraInitialized = true;
    }
  }

  private mapBounds(state: Readonly<GameState>): {
    width: number;
    height: number;
    center: { x: number; y: number };
  } {
    const origin = this.mapOrigin(state);
    const maxCenterX = origin.x + HEX_WIDTH * ((state.map.width - 1) + (state.map.height - 1) / 2);
    const maxCenterY = origin.y + HEX_SIZE * 1.5 * (state.map.height - 1);
    const width = maxCenterX + HEX_WIDTH / 2 + WORLD_PADDING;
    const height = maxCenterY + HEX_HEIGHT / 2 + WORLD_PADDING;
    return {
      width,
      height,
      center: { x: width / 2, y: height / 2 },
    };
  }

  private mapOrigin(state: Readonly<GameState>): { x: number; y: number } {
    void state;
    return {
      x: WORLD_PADDING + HEX_WIDTH / 2,
      y: WORLD_PADDING + HEX_HEIGHT / 2,
    };
  }

  private hexToWorld(state: Readonly<GameState>, position: HexCoord): { x: number; y: number } {
    const origin = this.mapOrigin(state);
    return {
      x: origin.x + HEX_WIDTH * (position.q + position.r / 2),
      y: origin.y + HEX_SIZE * 1.5 * position.r,
    };
  }

  private worldToHex(screenX: number, screenY: number): HexCoord | null {
    if (!this.current) return null;
    const point = this.cameras.main.getWorldPoint(screenX, screenY);
    let nearest: { position: HexCoord; distance: number } | null = null;
    for (const tile of this.current.state.map.tiles) {
      const center = this.hexToWorld(this.current.state, tile);
      const candidate = distance(point, center);
      if (candidate <= HEX_SIZE * 1.08 && (!nearest || candidate < nearest.distance)) {
        nearest = { position: { q: tile.q, r: tile.r }, distance: candidate };
      }
    }
    return nearest?.position ?? null;
  }

  private hexPoints(center: { x: number; y: number }): Phaser.Math.Vector2[] {
    return Array.from({ length: 6 }, (_, index) => {
      const angle = Phaser.Math.DegToRad(60 * index + 30);
      return new Phaser.Math.Vector2(center.x + HEX_SIZE * Math.cos(angle), center.y + HEX_SIZE * Math.sin(angle));
    });
  }

  private draw(render: BoardRenderState): void {
    const { state } = render;
    this.graphics.clear();
    this.activeLabelKeys.clear();
    const legal = new Set((render.legalDestinations ?? []).map((position) => `${position.q},${position.r}`));
    const path = new Set((render.pendingPath ?? []).map((position) => `${position.q},${position.r}`));
    const attackTargets = new Set(render.attackTargetIds ?? []);
    const suppliedTiles = new Set(render.suppliedTileKeys ?? []);
    const checkpointPreview = new Set((render.checkpointPreviewPositions ?? []).map((position) => String(position.q) + ',' + String(position.r)));
    const selectedCheckpointPreview = render.checkpointPreviewSelected
      ? `${render.checkpointPreviewSelected.q},${render.checkpointPreviewSelected.r}`
      : null;
    const blockedZombies = new Set(render.blockedZombieIds ?? []);
    const selected = render.selectedPosition;
    const hordeDirection = render.hordeDirection ?? null;
    const entrance = hordeDirection ? getHordeEntrance(state.map, hordeDirection) : undefined;
    const entranceKeys = new Set(entrance?.roadTiles.map((position) => `${position.q},${position.r}`) ?? []);

    for (const tile of state.map.tiles) {
      const center = this.hexToWorld(state, tile);
      const key = `${tile.q},${tile.r}`;
      const tileSelected = selected ? sameHex(selected, tile) : false;
      const isPath = path.has(key);
      const isLegal = legal.has(key);
      const fill = tileSelected
        ? 0x366a92
        : isPath
          ? 0x8a6b2a
          : isLegal
            ? 0x154f67
            : entranceKeys.has(key)
              ? 0x4c3a21
              : tile.road
                ? 0x253b47
                : 0x12222d;
      const line = tileSelected ? 0x81d4fa : isLegal ? 0x54d7ff : isPath ? 0xffcf66 : 0x344b56;
      this.graphics.fillStyle(fill, 1);
      this.graphics.lineStyle(tileSelected || isLegal ? 2 : 1, line, 1);
      this.graphics.fillPoints(this.hexPoints(center), true);
      this.graphics.strokePoints(this.hexPoints(center), true);
      if (render.supplyOverlay) {
        const supplied = suppliedTiles.has(tile.key) || suppliedTiles.has(key);
        this.graphics.fillStyle(supplied ? 0x38a9a4 : 0x02070b, supplied ? 0.18 : 0.52);
        this.graphics.fillPoints(this.hexPoints(center), true);
        const sectorBoundary = getSectorBranchIds(state.map, { q: tile.q, r: tile.r }).length > 1;
        if (sectorBoundary) {
          this.graphics.lineStyle(2, 0xf0c867, 0.82);
          this.graphics.strokePoints(this.hexPoints(center), true);
        }
      }
      if (isLegal) this.drawMarker(center, 0x54d7ff, 0.32);
      if (isPath) this.drawMarker(center, 0xffcf66, 0.18);
      if (checkpointPreview.has(key)) {
        const previewSelected = selectedCheckpointPreview === key;
        this.graphics.lineStyle(previewSelected ? 4 : 2, previewSelected ? 0xffd36e : 0x72e0c2, 0.95);
        this.graphics.strokeCircle(center.x, center.y, HEX_SIZE * 0.78);
        this.drawMarker(center, previewSelected ? 0xffd36e : 0x72e0c2, previewSelected ? 0.52 : 0.3);
      }

      const facility = state.facilities.find((candidate) => sameHex(candidate.position, tile));
      if (facility) {
        const icon = facility.type === 'capital' ? '◆' : facility.type === 'city' ? '●' : facility.type === 'powerPlant' ? '⚡' : facility.type === 'farm' ? 'F' : '▣';
        const color = facility.status === 'ruined'
          ? '#ff8585'
          : facility.infected > 0
            ? '#ffb06b'
            : facility.operationalStatus === 'stopped'
              ? '#8b9aa2'
              : facility.owner === 'player'
                ? '#c9f0d1'
                : '#d7c7a0';
        this.addLabel(`facility:${facility.id}:icon`, icon, center.x, center.y - 5, color, 14, true);
        if (facility.infected > 0) {
          this.graphics.lineStyle(3, 0xff665f, 0.95);
          this.graphics.strokeCircle(center.x, center.y, 15);
          this.addLabel(
            `facility:${facility.id}:infection`,
            `!${facility.infected}`,
            center.x + 13,
            center.y - 18,
            '#ff8d82',
            8,
            true,
          );
        } else if (facility.operationalStatus === 'stopped' && facility.owner === 'player') {
          this.addLabel(`facility:${facility.id}:status`, '×', center.x + 12, center.y - 14, '#a8b3b9', 9, true);
        } else if (render.supplyOverlay && facility.owner === 'player' && !suppliedTiles.has(tile.key) && !suppliedTiles.has(key)) {
          this.addLabel(`facility:${facility.id}:status`, '⊘', center.x + 12, center.y - 14, '#ef8c7a', 9, true);
        }
        if (tileSelected) {
          this.addLabel(
            `facility:${facility.id}:detail`,
            `${facility.id} W${facility.workers} I${facility.infected}`,
            center.x,
            center.y + 21,
            '#f3f7f9',
            8,
            true,
          );
        }
      }
      const checkpoint = state.checkpoints.find((candidate) => sameHex(candidate.position, tile));
      if (checkpoint) {
        const checkpointColor = checkpoint.infected > 0
          ? '#ff9b7d'
          : checkpoint.status === 'operational'
            ? '#a4e8ff'
            : checkpoint.status === 'remnant'
              ? '#d5c58e'
              : checkpoint.status === 'ruined'
                ? '#df8080'
                : '#9e7895';
        this.addLabel(
          `checkpoint:${checkpoint.id}:icon`,
          '▤',
          center.x,
          center.y + 10,
          checkpointColor,
          11,
          true,
        );
        if (checkpoint.infected > 0) {
          this.addLabel(
            `checkpoint:${checkpoint.id}:infection`,
            `!${checkpoint.infected}`,
            center.x + 13,
            center.y + 13,
            '#ff8d82',
            8,
            true,
          );
        }
      }

      const unit = state.units.find((candidate) => candidate.actionState !== 'destroyed' && sameHex(candidate.position, tile));
      if (unit) {
        const isTarget = attackTargets.has(unit.id);
        const isSelected = render.selectedUnitId === unit.id;
        const isBlockedZombie = unit.type === 'zombie' && blockedZombies.has(unit.id);
        this.graphics.fillStyle(unit.type === 'zombie' ? 0xa24c55 : unit.type === 'nationalGuard' ? 0xb6d8ff : 0x7fc7a0, 1);
        this.graphics.lineStyle(isBlockedZombie ? 3 : isTarget ? 3 : isSelected ? 2 : 1, isBlockedZombie ? 0xff6b64 : isTarget ? 0xff8c69 : 0x071019, 1);
        this.graphics.fillCircle(center.x, center.y + 1, isSelected || isTarget ? 10 : 8);
        this.graphics.strokeCircle(center.x, center.y + 1, isSelected || isTarget ? 10 : 8);
        this.addLabel(
          `unit:${unit.id}:icon`,
          unit.type === 'zombie' ? 'Z' : unit.type === 'nationalGuard' ? 'G' : 'P',
          center.x,
          center.y - 5,
          '#071019',
          9,
          true,
        );
        if (unit.hp < unit.maxHp) this.drawHealth(center, unit.hp / Math.max(unit.maxHp, 1));
        if (render.supplyOverlay && unit.type !== 'zombie' && !suppliedTiles.has(tile.key) && !suppliedTiles.has(key)) {
          this.addLabel(`unit:${unit.id}:status`, '⊘', center.x - 13, center.y - 14, '#ef8c7a', 9, true);
        }
        if (isSelected) {
          this.addLabel(
            `unit:${unit.id}:detail`,
            `${unit.id} HP ${unit.hp}/${unit.maxHp}`,
            center.x,
            center.y + 23,
            '#f3f7f9',
            8,
            true,
          );
        }
      }
    }
    if (render.supplyOverlay) this.drawSupplyRadii(state, render.branchRadii ?? []);
    if (render.pendingPath && render.pendingPath.length > 1) {
      this.graphics.lineStyle(3, 0xffcf66, 0.9);
      const points = render.pendingPath.map((position) => this.hexToWorld(state, position));
      this.graphics.beginPath();
      this.graphics.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) this.graphics.lineTo(point.x, point.y);
      this.graphics.strokePath();
    }
    for (const [key, label] of this.labels) {
      if (!this.activeLabelKeys.has(key)) label.setVisible(false);
    }
  }

  private drawSupplyRadii(
    state: Readonly<GameState>,
    branchRadii: readonly { branchId: string; radius: number }[],
  ): void {
    const capital = state.facilities.find((facility) => facility.type === 'capital');
    if (!capital) return;
    const center = this.hexToWorld(state, capital.position);
    this.graphics.lineStyle(1, 0x67d0d4, 0.35);
    this.graphics.strokeCircle(center.x, center.y, Math.max(1, state.config.checkpoint.initialSupplyRadius) * HEX_SIZE * 1.4);
    for (const [index, branch] of [...branchRadii].sort((left, right) => left.branchId.localeCompare(right.branchId)).entries()) {
      const radius = Math.max(state.config.checkpoint.initialSupplyRadius, branch.radius);
      this.graphics.lineStyle(1, index % 2 === 0 ? 0x72e0c2 : 0xf0c867, 0.24);
      this.graphics.strokeCircle(center.x, center.y, radius * HEX_SIZE * 1.4);
    }
  }

  private drawMarker(center: { x: number; y: number }, color: number, alpha: number): void {
    this.graphics.fillStyle(color, alpha);
    this.graphics.fillCircle(center.x, center.y, 5);
  }

  private drawHealth(center: { x: number; y: number }, ratio: number): void {
    this.graphics.fillStyle(0x071019, 0.9);
    this.graphics.fillRect(center.x - 10, center.y + 12, 20, 3);
    this.graphics.fillStyle(ratio > 0.5 ? 0x7de0a1 : 0xef9a80, 1);
    this.graphics.fillRect(center.x - 10, center.y + 12, Math.max(0, 20 * ratio), 3);
  }

  private addLabel(
    key: `${LabelEntity}:${string}:${LabelPurpose}`,
    text: string,
    x: number,
    y: number,
    color: string,
    size: number,
    center = false,
  ): void {
    let label = this.labels.get(key);
    if (!label) {
      label = this.add.text(x, y, text, {
        color: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${size}px`,
        fontStyle: 'bold',
        stroke: '#071019',
        strokeThickness: 2,
      });
      if (center) label.setOrigin(0.5, 0.5);
      this.labels.set(key, label);
    } else if (label.text !== text) {
      label.setText(text);
    }
    label.setPosition(x, y);
    label.setVisible(true);
    label.setTint(Phaser.Display.Color.HexStringToColor(color).color);
    this.activeLabelKeys.add(key);
  }

  private handleShutdown(): void {
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.activeLabelKeys.clear();
  }
}

export function createBoardGame(
  parent: HTMLElement,
  callbacks: BoardCallbacks,
): Phaser.Game {
  const scene = new HexBoardScene(callbacks);
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: parent.clientWidth || 960,
    height: parent.clientHeight || 640,
    backgroundColor: '#071019',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false, roundPixels: true },
    input: { activePointers: 3 },
    scene,
  });
}
