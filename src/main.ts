// MKLS fork integration authored by Codex (LLM agent).
import { Plugin, Notice, requireApiVersion, TextFileView } from 'obsidian'
import PropertyGraphCanvasExtension from './canvas-extensions/property-graph-canvas-extension'
import PropertySchemaCanvasExtension from './canvas-extensions/property-schema-canvas-extension'
import RelationshipRulesCanvasExtension from './canvas-extensions/relationship-rules-canvas-extension'
import { Canvas, CanvasView } from './@types/Canvas'
import type { CanvasData } from './@types/AdvancedJsonCanvas'
import { canonicalHistory } from './utils/canonical-history'
import { CanvasGroupNodeData, CanvasFileNodeData } from './@types/AdvancedJsonCanvas'

// Utils
import IconsHelper from './utils/icons-helper'
import DebugHelper from './utils/debug-helper'

// Managers
import SettingsManager from './settings'
import WindowsManager from './managers/windows-manager'

// Patchers
import Patcher from './patchers/patcher'
import CanvasPatcher from './patchers/canvas-patcher'
import LinkSuggestionsPatcher from './patchers/link-suggestions-patcher'
import EmbedPatcher from './patchers/embed-patcher'
import MetadataCachePatcher from './patchers/metadata-cache-patcher'
import BacklinksPatcher from './patchers/backlinks-patcher'
import OutgoingLinksPatcher from './patchers/outgoing-links-patcher'
import FileManagerPatcher from './patchers/file-manager-patcher'
import PropertiesPatcher from './patchers/properties-patcher'
import SearchPatcher from './patchers/search-patcher'
import SearchCommandPatcher from './patchers/search-command-patcher'

// Canvas Extensions
import CanvasExtension from './canvas-extensions/canvas-extension'
import MetadataCanvasExtension from './canvas-extensions/metadata-canvas-extension'
import NodeRatioCanvasExtension from './canvas-extensions/node-ratio-canvas-extension'
import VariableBreakpointCanvasExtension from './canvas-extensions/variable-breakpoint-canvas-extension'
import GroupCanvasExtension from './canvas-extensions/group-canvas-extension'
import NodeTemplatesCanvasExtension from './canvas-extensions/node-templates-canvas-extension'
import PresentationCanvasExtension from './canvas-extensions/presentation-canvas-extension'
import ZOrderingCanvasExtension from './canvas-extensions/z-ordering-canvas-extension'
import BetterReadonlyCanvasExtension from './canvas-extensions/better-readonly-canvas-extension'
import EncapsulateCanvasExtension from './canvas-extensions/encapsulate-canvas-extension'
import CommandsCanvasExtension from './canvas-extensions/commands-canvas-extension'
import AutoResizeNodeCanvasExtension from './canvas-extensions/auto-resize-node-canvas-extension'
import PortalsCanvasExtension from './canvas-extensions/portals-canvas-extension'
import FrontmatterControlButtonCanvasExtension from './canvas-extensions/frontmatter-control-button-canvas-extension'
import BetterDefaultSettingsCanvasExtension from './canvas-extensions/better-default-settings-canvas-extension'
import ColorPaletteCanvasExtension from './canvas-extensions/color-palette-canvas-extension'
import CollapsibleGroupsCanvasExtension from './canvas-extensions/collapsible-groups-canvas-extension'
import FocusModeCanvasExtension from './canvas-extensions/focus-mode-canvas-extension'
import AutoFileNodeEdgesCanvasExtension from './canvas-extensions/auto-file-node-edges-canvas-extension'
import FlipEdgeCanvasExtension from './canvas-extensions/flip-edge-canvas-extension'
import EdgeSelectionCanvasExtension from './canvas-extensions/edge-selection-canvas-extension'
import ExportCanvasExtension from './canvas-extensions/export-canvas-extension'
import FloatingEdgeCanvasExtension from './canvas-extensions/floating-edge-canvas-extension'
import EdgeHighlightCanvasExtension from './canvas-extensions/edge-highlight-canvas-extension'
import CopyNodeReferenceCanvasExtension from './canvas-extensions/copy-node-reference-canvas-extension'
import ReadingModeFixCanvasExtension from './canvas-extensions/reading-mode-fix-canvas-extension'
import PdfAnnotationCanvasExtension from './canvas-extensions/pdf-annotation-canvas-extension'

// Advanced Styles
import NodeStylesExtension from './canvas-extensions/advanced-styles/node-styles'
import EdgeStylesExtension from './canvas-extensions/advanced-styles/edge-styles'

// Dataset Exposers
import CanvasMetadataExposerExtension from './canvas-extensions/dataset-exposers/canvas-metadata-exposer'
import NodeInteractionExposerExtension from './canvas-extensions/dataset-exposers/node-interaction-exposer'
import NodeExposerExtension from './canvas-extensions/dataset-exposers/node-exposer'
import EdgeExposerExtension from './canvas-extensions/dataset-exposers/edge-exposer'
import CanvasWrapperExposerExtension from './canvas-extensions/dataset-exposers/canvas-wrapper-exposer'
import BasesTableViewPatcher from './patchers/bases-table-view-patcher'
import FileRecovery from './@types/FileRecoveryPlugin'

type PatcherConstructor = new (plugin: AdvancedCanvasPlugin) => Patcher
type CanvasExtensionConstructor = new (plugin: AdvancedCanvasPlugin) => CanvasExtension

const PATCHERS: (PatcherConstructor | false)[] = [
  // Core canvas patchers
  CanvasPatcher,
  SearchCommandPatcher,

  // Core metadata patchers
  MetadataCachePatcher,
  FileManagerPatcher,

  // Direct metadata dependant patchers
  PropertiesPatcher,
  (!requireApiVersion("1.12.0") && BacklinksPatcher),
  OutgoingLinksPatcher,

  // Metadata dependant patchers
  (requireApiVersion("1.9.0") && BasesTableViewPatcher),
  LinkSuggestionsPatcher,
  EmbedPatcher,
  SearchPatcher,
]

const CANVAS_EXTENSIONS: CanvasExtensionConstructor[] = [
  // Advanced JSON Canvas Extensions
  MetadataCanvasExtension,
  NodeStylesExtension,
  EdgeStylesExtension,
  NodeRatioCanvasExtension,
  FloatingEdgeCanvasExtension,
  AutoResizeNodeCanvasExtension,
  CollapsibleGroupsCanvasExtension,
  ColorPaletteCanvasExtension,
  PresentationCanvasExtension,
  PortalsCanvasExtension,
  PdfAnnotationCanvasExtension,

  // UI Extensions (Non-savable data)
  CanvasMetadataExposerExtension,
  CanvasWrapperExposerExtension,
  NodeExposerExtension,
  EdgeExposerExtension,
  NodeInteractionExposerExtension,

  FrontmatterControlButtonCanvasExtension,
  BetterDefaultSettingsCanvasExtension,
  CommandsCanvasExtension,
  BetterReadonlyCanvasExtension,
  ReadingModeFixCanvasExtension,
  PropertyGraphCanvasExtension,
  PropertySchemaCanvasExtension,
  RelationshipRulesCanvasExtension,
  GroupCanvasExtension,
  NodeTemplatesCanvasExtension,
  VariableBreakpointCanvasExtension,
  EdgeHighlightCanvasExtension,
  AutoFileNodeEdgesCanvasExtension,
  FlipEdgeCanvasExtension,
  ZOrderingCanvasExtension,
  ExportCanvasExtension,
  FocusModeCanvasExtension,
  EncapsulateCanvasExtension,
  EdgeSelectionCanvasExtension,
  CopyNodeReferenceCanvasExtension
]

export default class AdvancedCanvasPlugin extends Plugin {
  debugHelper: DebugHelper

  settings: SettingsManager
  windowsManager: WindowsManager

  patchers: Patcher[]
  canvasExtensions: CanvasExtension[]

  async onload() {
    if (this.app.plugins.getPlugin('advanced-canvas')) {
      new Notice('Disable the upstream plugin before enabling this fork; both plugins patch the same native classes.')
      throw Error('Conflicting Advanced Canvas plugin is enabled')
    }
    IconsHelper.addIcons()

    this.settings = new SettingsManager(this)
    await this.settings.loadSettings()
    this.settings.addSettingsTab()

    this.windowsManager = new WindowsManager(this)

    this.patchers = PATCHERS.map((PatcherClass) => {
      if (!PatcherClass) return undefined

      try { return new PatcherClass(this) }
      catch (e) {
        console.error(`Error initializing patcher ${PatcherClass.name}:`, e)
        return undefined
      }
    }).filter((p): p is Patcher => p !== undefined)

    this.canvasExtensions = CANVAS_EXTENSIONS.map((ExtensionClass) => {
      try { return new ExtensionClass(this) }
      catch (e) {
        console.error(`Error initializing ac-extension ${ExtensionClass.name}:`, e)
        return undefined
      }
    }).filter((e): e is CanvasExtension => e !== undefined)
  }

  override unload() {
    // Codex (LLM agent): flush editors while adapters are installed, then restore
    // canonical records so native saves after disable cannot persist projections.
    // Component.unload removes registered hooks BEFORE onunload. Run this
    // normalization first, while upstream's serialization adapters are active.
    try {
      if (this.canvasExtensions) {
        try { this.canvasExtensions.find((extension): extension is PropertyGraphCanvasExtension => extension instanceof PropertyGraphCanvasExtension)?.prepareUnload() }
        catch (error) { console.error('Unable to flush property editors on unload', error) }
        try {
          this.canvasExtensions.find((extension): extension is RelationshipRulesCanvasExtension => extension instanceof RelationshipRulesCanvasExtension)?.prepareUnload()
          this.patchers.find((patcher): patcher is CanvasPatcher => patcher instanceof CanvasPatcher)?.prepareUnload()
        } catch (error) { console.error('Unable to cancel provisional connections on unload', error) }
        for (const canvas of this.getCanvases()) {
          try {
            const transform = (data: CanvasData) => this.app.workspace.trigger('advanced-canvas:data-requested', canvas, data)
            canvas.history.data = (canvas.history.data as CanvasData[]).map(data => canonicalHistory(data, transform))
            const transient = [...canvas.nodes.values()].some(node => {
              const data = node.getData()
              return PortalsCanvasExtension.isPortalElement(node.id) || (data as CanvasGroupNodeData).collapsedData !== undefined || (data as CanvasFileNodeData).isPortalLoaded !== undefined
            })
            const data = canonicalHistory(canvas.getData(), transform)
            if (transient) canvas.importData(data, true, true)
            Reflect.set(canvas, 'data', data) // Native 1.14.4 serializer cache, refreshed without reading it.
            for (const node of canvas.nodes.values()) node.collapseEl?.remove()
          } catch (error) { console.error('Unable to restore canonical canvas on unload', error) }
        }
      }
    } finally {
      // Codex (LLM agent): never leave event/patch registrations behind because
      // an editor or canonical-model normalization failed during hot reload.
      super.unload()
    }
  }
  onunload() {}

  getCanvases(): Canvas[] {
    return this.app.workspace.getLeavesOfType('canvas')
      .map(leaf => (leaf.view as unknown as CanvasView)?.canvas)
      .filter(canvas => canvas)
  }

  getCurrentCanvasView(): CanvasView | null {
    const canvasView = this.app.workspace.getActiveViewOfType(TextFileView)
    if (canvasView?.getViewType() !== 'canvas') return null
    return canvasView as unknown as CanvasView
  }

  getCurrentCanvas(): Canvas | null {
    return this.getCurrentCanvasView()?.canvas || null
  }

  createFileSnapshot(path: string, content: string) {
    const fileRecoveryPlugin = this.app.internalPlugins.plugins['file-recovery']?.instance as unknown as FileRecovery | undefined
    if (!fileRecoveryPlugin) return

    fileRecoveryPlugin.forceAdd(path, content)
  }

  // this.app.plugins.plugins["advanced-canvas"].enableDebugMode()
  enableDebugMode() {
    if (this.debugHelper) return
    this.debugHelper = new DebugHelper(this)
  }
}
