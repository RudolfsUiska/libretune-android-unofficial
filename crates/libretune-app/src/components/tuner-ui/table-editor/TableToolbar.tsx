import { Copy, Clipboard, Undo2, Redo2, Flame, Crosshair, Box, Wand2, Upload, Download, ArrowUpDown, Shrink } from 'lucide-react';
import { useUiScale } from '../../../utils/uiScale';
import '../TableEditor.css';

interface TableToolbarProps {
  onSetEqual: () => void;
  onIncrease: () => void;
  onDecrease: () => void;
  onIncreaseMore: () => void;
  onDecreaseMore: () => void;
  onScale: () => void;
  onInterpolate: () => void;
  onSmooth: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBurn?: () => void;
  hasSelection: boolean;
  hasClipboard: boolean;
  canUndo: boolean;
  canRedo: boolean;
  followMode: boolean;
  onToggleFollowMode: () => void;
  hasOutputChannels: boolean;
  /** Y axis zero at bottom (rows reversed). Toggles the global table_y_axis_bottom setting. */
  yAxisBottom: boolean;
  onToggleYAxisBottom: () => void;
  show3D: boolean;
  onToggle3D: () => void;
  /** Shrink the grid so the whole table fits without scrolling. */
  fitToScreen: boolean;
  onToggleFitToScreen: () => void;
  /** Generate the whole table from engine specs (VE/ignition/AFR only). */
  onGenerate?: () => void;
  generatableLabel?: string;
  /** TunerStudio-compatible per-table .table file import/export. */
  onImportTable?: () => void;
  onExportTable?: () => void;
}

export default function TableToolbar({
  onSetEqual,
  onIncrease,
  onDecrease,
  onIncreaseMore,
  onDecreaseMore,
  onScale,
  onInterpolate,
  onSmooth,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  onBurn,
  hasSelection,
  hasClipboard,
  canUndo,
  canRedo,
  followMode,
  onToggleFollowMode,
  hasOutputChannels,
  yAxisBottom,
  onToggleYAxisBottom,
  show3D,
  onToggle3D,
  fitToScreen,
  onToggleFitToScreen,
  onGenerate,
  generatableLabel,
  onImportTable,
  onExportTable,
}: TableToolbarProps) {
  // Scaled up (phone), text labels would push the row past the screen edge;
  // icons alone keep it on one line (titles still name each button).
  const compact = useUiScale() > 1;
  return (
    <div className={`table-toolbar ${compact ? 'table-toolbar-compact' : ''}`}>
      <div className="table-toolbar-group">
        <button
          className="table-toolbar-btn"
          onClick={onSetEqual}
          disabled={!hasSelection}
          title="Set Equal (=)"
        >
          =
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onDecrease}
          disabled={!hasSelection}
          title="Decrease (&lt;)"
        >
          &lt;
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onIncrease}
          disabled={!hasSelection}
          title="Increase (&gt;)"
        >
          &gt;
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onDecreaseMore}
          disabled={!hasSelection}
          title="Decrease — subtract an amount (−)"
        >
          −
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onIncreaseMore}
          disabled={!hasSelection}
          title="Increase — add an amount (+)"
        >
          +
        </button>
      </div>

      <div className="table-toolbar-separator" />

      <div className="table-toolbar-group">
        <button
          className="table-toolbar-btn"
          onClick={onScale}
          disabled={!hasSelection}
          title="Multiply (×)"
        >
          ×
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onInterpolate}
          disabled={!hasSelection}
          title="Interpolate (/)"
        >
          /
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onSmooth}
          disabled={!hasSelection}
          title="Smooth (s)"
        >
          s
        </button>
      </div>

      <div className="table-toolbar-separator" />

      <div className="table-toolbar-group">
        <button
          className="table-toolbar-btn"
          onClick={onCopy}
          disabled={!hasSelection}
          title="Copy (Ctrl+C)"
          aria-label="Copy"
        >
          <Copy size={14} />
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onPaste}
          disabled={!hasClipboard}
          title="Paste (Ctrl+V)"
          aria-label="Paste"
        >
          <Clipboard size={14} />
        </button>
      </div>

      <div className="table-toolbar-separator" />

      <div className="table-toolbar-group">
        <button
          className="table-toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 size={14} />
        </button>
        <button
          className="table-toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <Redo2 size={14} />
        </button>
      </div>

      {onBurn && (
        <>
          <div className="table-toolbar-separator" />
          <button
            className="table-toolbar-btn table-toolbar-btn-burn"
            onClick={onBurn}
            title="Burn to ECU"
          >
            <Flame size={14} /> <span className="table-toolbar-label">Burn</span>
          </button>
        </>
      )}

      <div className="table-toolbar-separator" />
      
      <button
        className={`table-toolbar-btn table-toolbar-btn-follow ${followMode ? 'active' : ''}`}
        onClick={onToggleFollowMode}
        disabled={!hasOutputChannels}
        title={hasOutputChannels ? `Follow Mode (F) - ${followMode ? 'ON' : 'OFF'}` : 'Follow Mode unavailable (no output channels defined)'}
      >
        <Crosshair size={14} /> <span className="table-toolbar-label">Follow</span>
      </button>
      
      <button
        className={`table-toolbar-btn ${yAxisBottom ? 'active' : ''}`}
        onClick={onToggleYAxisBottom}
        aria-pressed={yAxisBottom}
        aria-label="Y axis zero at bottom"
        title={`Y axis zero at ${yAxisBottom ? 'bottom' : 'top'} - click to flip`}
      >
        <ArrowUpDown size={14} /> Y{yAxisBottom ? '↑' : '↓'}
      </button>

      <button
        className={`table-toolbar-btn table-toolbar-btn-3d ${show3D ? 'active' : ''}`}
        onClick={onToggle3D}
        title={`3D View - ${show3D ? 'ON' : 'OFF'}`}
      >
        <Box size={14} /> <span className="table-toolbar-label">3D</span>
      </button>
      <button
        className={`table-toolbar-btn ${fitToScreen ? 'active' : ''}`}
        onClick={onToggleFitToScreen}
        title={`Fit whole table on screen - ${fitToScreen ? 'ON' : 'OFF'}`}
      >
        <Shrink size={14} /> <span className="table-toolbar-label">Fit</span>
      </button>

      {onGenerate && (
        <>
          <div className="table-toolbar-separator" />
          <button
            className="table-toolbar-btn table-toolbar-btn-generate"
            onClick={onGenerate}
            title={`Generate ${generatableLabel ?? 'table'} from engine specs`}
          >
            <Wand2 size={14} /> <span className="table-toolbar-label">Generate</span>
          </button>
        </>
      )}

      {(onImportTable || onExportTable) && (
        <>
          <div className="table-toolbar-separator" />
          {onImportTable && (
            <button
              className="table-toolbar-btn"
              onClick={onImportTable}
              title="Load Table from File... (.table)"
              aria-label="Load Table from File"
            >
              <Upload size={14} />
            </button>
          )}
          {onExportTable && (
            <button
              className="table-toolbar-btn"
              onClick={onExportTable}
              title="Save Table to File... (.table)"
              aria-label="Save Table to File"
            >
              <Download size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

