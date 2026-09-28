import { ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { Minimize2 } from 'lucide-react';
import { MenuBar } from './MenuBar';
import { Toolbar } from './Toolbar';
import { TabBar, Tab } from './TabBar';
import { Sidebar } from './Sidebar';
import { StatusBar, ChannelInfoForStatusBar } from './StatusBar';
import { AgentSidePanel } from '../agent/AgentSidePanel';
import { isAndroid } from '../../utils/platform';
import { useUiScale } from '../../utils/uiScale';
import { useFullscreenView, openTabsFullscreen } from '../../utils/viewFullscreen';
import '../../styles/view-fullscreen.css';
import './TunerLayout.css';

export interface TunerLayoutProps {
  // Menu configuration
  menuItems: MenuItem[];
  
  // Toolbar configuration
  toolbarItems: ToolbarItem[];
  
  // Tab configuration
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder?: (tabs: Tab[]) => void;
  onTabPopout?: (tabId: string) => void;
  
  // Sidebar configuration
  sidebarItems: SidebarNode[];
  sidebarVisible: boolean;
  onSidebarToggle: () => void;
  /** Callback when an item is selected. highlightTerm is the search query if user clicked from search results. */
  onSidebarItemSelect: (item: SidebarNode, highlightTerm?: string) => void;
  /** Index of searchable content for deep search (target -> terms) */
  searchIndex?: Record<string, string[]>;
  
  // Status bar
  statusItems: StatusItem[];

  // Connection status
  connected: boolean;
  ecuName?: string;
  connectionPhase?: import('../../utils/connectionWorkflow').ConnectionPhase;
  connectionPort?: string;
  onConnectionClick?: () => void;

  // Current project name (shown in sidebar header)
  projectName?: string;

  // Unit system
  unitsSystem?: 'metric' | 'imperial';

  // AI assistant side panel (right-hand, non-modal)
  agentPanelVisible?: boolean;
  onAgentPanelCollapse?: () => void;
  onAgentPanelPopOut?: () => void;

  // Realtime channel data for status bar (subscriptions handled by StatusBar itself)
  realtimeChannels?: string[];
  channelInfoMap?: Record<string, ChannelInfoForStatusBar>;

  // Content
  children: ReactNode;
}

export interface MenuItem {
  id: string;
  label: string;
  accelerator?: string; // e.g., "&File" means Alt+F
  items?: MenuItem[];
  separator?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
}

export interface ToolbarItem {
  id: string;
  icon: string;
  tooltip: string;
  disabled?: boolean;
  active?: boolean;
  /** Visual emphasis for pending ECU burn (red flame icon). */
  variant?: 'burn-pending';
  separator?: boolean;
  onClick?: () => void;
  /** Optional custom content to render instead of a standard icon button */
  content?: React.ReactNode;
}

export interface SidebarNode {
  id: string;
  label: string;
  icon?: string;
  children?: SidebarNode[];
  expanded?: boolean;
  type?: 'folder' | 'table' | 'dialog' | 'dashboard' | 'log' | 'help';
  data?: unknown;
  /** Whether item is disabled (visibility condition evaluated to false) */
  disabled?: boolean;
  /** Tooltip explaining why item is disabled */
  disabledReason?: string;
}

export interface StatusItem {
  id: string;
  content: ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  onClick?: () => void;
}

export function TunerLayout({
  menuItems,
  toolbarItems,
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onTabPopout,
  sidebarItems,
  sidebarVisible,
  onSidebarToggle,
  onSidebarItemSelect,
  searchIndex,
  statusItems,
  connected,
  ecuName,
  connectionPhase,
  connectionPort,
  onConnectionClick,
  projectName,
  unitsSystem,
  agentPanelVisible,
  onAgentPanelCollapse,
  onAgentPanelPopOut,
  realtimeChannels,
  channelInfoMap,
  children,
}: TunerLayoutProps) {
  // Scaled up, the menu row does not fit; MenuBar becomes a burger button at
  // the right end of the toolbar, saving the row for content.
  const compact = useUiScale() > 1;
  // Any tab (a VE table, a dialog, a curve) can take over the whole window.
  const tabFullscreen = useFullscreenView();
  const { enter: enterTabFullscreen } = tabFullscreen;

  // View > Open Tabs Fullscreen: a tab that has just been opened, and is now
  // the active one, goes straight to fullscreen. Tabs present on first render
  // were not "opened"; the dashboard tab follows its own option instead.
  const openTabsFs = openTabsFullscreen.use();
  const knownTabIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = tabs.map((t) => t.id);
    const known = knownTabIds.current;
    knownTabIds.current = new Set(ids);
    if (!known || !openTabsFs || !activeTabId || activeTabId === 'dashboard') return;
    if (!known.has(activeTabId) && ids.includes(activeTabId)) enterTabFullscreen();
  }, [tabs, activeTabId, openTabsFs, enterTabFullscreen]);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [agentPanelWidth, setAgentPanelWidth] = useState(360);

  const handleSidebarResize = useCallback((newWidth: number) => {
    setSidebarWidth(Math.max(150, Math.min(400, newWidth)));
  }, []);

  const handleAgentPanelResize = useCallback((newWidth: number) => {
    setAgentPanelWidth(Math.max(280, Math.min(640, newWidth)));
  }, []);

  return (
    <div className="tuner-layout">
      {/* Menu Bar */}
      {!compact && <MenuBar items={menuItems} />}
      
      {/* Toolbar, led by the sidebar toggle: on a narrow (phone) screen the
          sidebar takes most of the width, so it needs a one-tap way out. */}
      <Toolbar
        items={[
          {
            id: 'toggle-sidebar',
            icon: sidebarVisible ? 'sidebar-hide' : 'sidebar-show',
            tooltip: sidebarVisible ? 'Hide sidebar' : 'Show sidebar',
            onClick: onSidebarToggle,
          },
          {
            id: 'fullscreen-tab',
            icon: 'fullscreen',
            tooltip: 'Fullscreen tab (Back or Esc to exit)',
            onClick: tabFullscreen.enter,
          },
          { id: 'sep-sidebar', icon: '', tooltip: '', separator: true },
          ...toolbarItems,
        ]}
        trailing={compact ? <MenuBar items={menuItems} /> : undefined}
      />
      
      {/* Main content area */}
      <div className="tuner-layout-main">
        {/* Sidebar */}
        {sidebarVisible && (
          <Sidebar
            items={sidebarItems}
            width={sidebarWidth}
            onResize={handleSidebarResize}
            onItemSelect={onSidebarItemSelect}
            searchIndex={searchIndex}
            projectName={projectName}
            activeItemId={activeTabId}
          />
        )}
        
        {/* Document area */}
        <div className="tuner-layout-documents">
          {/* Tab bar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabSelect={onTabSelect}
            onTabClose={onTabClose}
            onTabReorder={onTabReorder}
            // Android cannot open a second window; pop-out would only fail.
            onTabPopout={isAndroid() ? undefined : onTabPopout}
          />
          
          {/* Tab content */}
          <div className={`tuner-layout-content ${tabFullscreen.fullscreen ? 'tuner-layout-content-fullscreen' : ''}`}>
            {tabFullscreen.fullscreen && (
              <button className="view-fullscreen-exit" onClick={tabFullscreen.exit} title="Exit fullscreen">
                <Minimize2 size={18} />
              </button>
            )}
            {children}
          </div>
        </div>
        
        {/* AI Assistant side panel (right-hand, non-modal). Must be a flex
            child of .tuner-layout-main (horizontal flex) so it sits beside the
            documents rather than stacking vertically below them. */}
        {agentPanelVisible && (
          <AgentSidePanel
            width={agentPanelWidth}
            onResize={handleAgentPanelResize}
            onCollapse={() => onAgentPanelCollapse?.()}
            onPopOut={() => onAgentPanelPopOut?.()}
          />
        )}
      </div>
      
      {/* Status Bar */}
      <StatusBar
        items={statusItems}
        connected={connected}
        ecuName={ecuName}
        connectionPhase={connectionPhase}
        connectionPort={connectionPort}
        onConnectionClick={onConnectionClick}
        unitsSystem={unitsSystem}
        realtimeChannels={realtimeChannels}
        channelInfoMap={channelInfoMap}
      />
    </div>
  );
}
