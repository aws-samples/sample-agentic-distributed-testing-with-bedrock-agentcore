import { useState } from 'react'
import styles from './ModulePanel.module.css'
import Icon from './Icon'

function toArr(v) {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * Shared left panel — Runner, Editor, Focus Modal.
 *
 * showSessionIndicators  runner/focus: connected/running dot
 * showStatusBadges       runner/focus: PASS/FAIL badge on TC rows
 * showTcDetail           runner/focus: TC rows are expanders; clicking expands
 *                         a read-only detail pane inline. Includes Expand All /
 *                         Collapse All controls in the filter bar.
 * onModuleDelete         editor: ✕ delete on module header
 * onTcAdd                editor: + Add TC inside expanded module
 *
 * expandedModule         editor: controlled single-module expansion
 *                        runner/focus: ignored — panel manages its own Set
 */
export default function ModulePanel({
  style,
  modules = [],
  testCases = {},
  testResults = {},
  sessionStatus = {},
  activeModules,
  // Editor-controlled expansion: single string OR Set of names
  expandedModule,
  expandedModules, // Set<string> — takes priority over expandedModule when provided
  selectedTcId: externalSelectedTcId,
  // Callbacks
  onModuleClick,
  onTcClick,
  onModuleDelete,
  onTcAdd,
  onExpandAll,   // editor: called to expand all modules
  onCollapseAll, // editor: called to collapse all modules
  // Modes
  showSessionIndicators = false,
  showStatusBadges = false,
  showTcDetail = false,
  showExpandControls = false, // editor: show ⊞/⊟ even without showTcDetail
  // Search
  searchQuery = '',
  onSearchChange,
  // Slots
  toolbar,
  statsBar,
  footer,
}) {
  // Self-managed expansion state (runner / focus modal)
  // When a single module is pre-selected (e.g. FocusModal), start it expanded
  const [expandedMods, setExpandedMods] = useState(
    () => showTcDetail && expandedModule ? new Set([expandedModule]) : new Set()
  )
  const [expandedTcs, setExpandedTcs] = useState(new Set())

  const getStatus = (tcId) => testResults[tcId]?.status || 'PENDING'
  // Map test status to a Material Symbols icon name
  const statusIconName = (s) => {
    if (s === 'PASS') return 'check_circle'
    if (s === 'FAIL') return 'cancel'
    if (s === 'RUNNING') return 'progress_activity'
    return 'radio_button_unchecked'
  }

  // Module expansion: if showTcDetail, use internal Set; else use prop (Set or string)
  const isModExpanded = (mod) => showTcDetail
    ? expandedMods.has(mod)
    : expandedModules
      ? expandedModules.has(mod)
      : expandedModule === mod

  const handleModuleClick = (mod) => {
    if (showTcDetail) {
      setExpandedMods(prev => {
        const next = new Set(prev)
        next.has(mod) ? next.delete(mod) : next.add(mod)
        return next
      })
    }
    onModuleClick?.(mod)
  }

  // TC expansion (only when showTcDetail)
  const handleTcClick = (tcId) => {
    if (showTcDetail) {
      setExpandedTcs(prev => {
        const next = new Set(prev)
        next.has(tcId) ? next.delete(tcId) : next.add(tcId)
        return next
      })
    }
    onTcClick?.(tcId)
  }

  const allTcIds = () => Object.values(testCases).flat().map(t => t.id)

  // Runner: expand/collapse only modules (not TC detail panes)
  const expandAll = () => {
    if (showTcDetail) {
      setExpandedMods(new Set(modules))
      // Don't auto-expand TC detail panes — user opens those explicitly
    } else if (onExpandAll) {
      onExpandAll()
    }
  }
  const collapseAll = () => {
    if (showTcDetail) {
      setExpandedMods(new Set())
      setExpandedTcs(new Set())
    } else if (onCollapseAll) {
      onCollapseAll()
    }
  }

  // Editor: selectedTcId from parent; runner/focus: not used (detail is inside TC expander)
  const selectedTcId = !showTcDetail ? externalSelectedTcId : null

  return (
    <div className={styles.panel} style={style}>
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      {statsBar}
      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        {(showTcDetail || showExpandControls) && (
          <div className={styles.expandBtns}>
            <button className={styles.expandBtn} onClick={expandAll} title="Expand all modules">⊞</button>
            <button className={styles.expandBtn} onClick={collapseAll} title="Collapse all">⊟</button>
          </div>
        )}
      </div>

      <div className={styles.list}>
        {modules.length === 0 && <div className={styles.empty}>No modules</div>}

        {modules.map((mod, idx) => {
          const tcs = testCases[mod] || []
          const sess = sessionStatus[mod] || {}
          const isRunning = activeModules?.has(mod)
          const modExpanded = isModExpanded(mod)

          let indClass = styles.indicator
          if (showSessionIndicators) {
            if (isRunning) indClass += ' ' + styles.indicatorRunning
            else if (sess.connecting) indClass += ' ' + styles.indicatorConnecting
            else if (sess.connected) indClass += ' ' + styles.indicatorConnected
          }

          const filteredTcs = searchQuery
            ? tcs.filter(tc =>
                tc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                tc.title.toLowerCase().includes(searchQuery.toLowerCase()))
            : tcs

          return (
            <div key={mod} className={styles.group}>
              <div
                className={`${styles.moduleHeader}${modExpanded ? ' ' + styles.moduleHeaderActive : ''}`}
                onClick={() => handleModuleClick(mod)}
              >
                {showTcDetail && (
                  <span className={styles.chevron}>{modExpanded ? '▾' : '▸'}</span>
                )}
                {showSessionIndicators && <div className={indClass} />}
                <span className={styles.modIdBadge}>MD-{String(idx + 1).padStart(3, '0')}</span>
                <span className={styles.modName}>{mod}</span>
                <span className={styles.count}>{tcs.length}</span>
                <div className={styles.moduleActions}>
                  {onModuleDelete && (
                    <button
                      className={styles.moduleDelBtn}
                      onClick={(e) => { e.stopPropagation(); onModuleDelete(mod) }}
                      title="Delete module"
                    ><Icon name="close" size={13} /></button>
                  )}
                </div>
              </div>

              {modExpanded && (
                <>
                  {filteredTcs.map((tc) => {
                    const status = getStatus(tc.id)
                    const tcExpanded = showTcDetail && expandedTcs.has(tc.id)
                    const isSelected = selectedTcId === tc.id
                    const selectedResult = tcExpanded ? testResults[tc.id] : null

                    return (
                      <div key={tc.id} className={styles.tcGroup}>
                        <div
                          className={`${styles.tcItem}${isSelected ? ' ' + styles.tcSelected : ''}${tcExpanded ? ' ' + styles.tcExpanded : ''}`}
                          onClick={() => handleTcClick(tc.id)}
                        >
                          {showTcDetail && (
                            <span className={styles.tcChevron}>{tcExpanded ? '▾' : '▸'}</span>
                          )}
                          <span className={styles.tcId}>{tc.id}</span>
                          <span className={styles.tcTitle}>{tc.title}</span>
                          {showStatusBadges && (
                            <span className={`${styles.statusBadge} ${styles['status_' + status]}`}>
                              <Icon name={statusIconName(status)} />
                              {status}
                            </span>
                          )}
                        </div>

                        {tcExpanded && (
                          <div className={styles.tcDetail}>
                            {selectedResult?.status && (
                              <div className={styles.detSection}>
                                <div className={styles.detLabel}>Result</div>
                                <div className={`${styles.detVerdict} ${styles['detVerdict_' + selectedResult.status.toLowerCase()]}`}>
                                  {selectedResult.status}
                                </div>
                                {selectedResult.reason && (
                                  <div className={styles.detReason}>{selectedResult.reason}</div>
                                )}
                              </div>
                            )}
                            {toArr(tc.preconditions).filter(Boolean).length > 0 && (
                              <div className={styles.detSection}>
                                <div className={styles.detLabel}>Preconditions</div>
                                <div className={styles.detVal}>
                                  {toArr(tc.preconditions).filter(Boolean).map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
                                </div>
                              </div>
                            )}
                            <div className={styles.detSection}>
                              <div className={styles.detLabel}>Steps</div>
                              {(tc.steps || []).map((s, i) => (
                                <div key={i} className={styles.detStep}>
                                  <span className={styles.detStepNum}>{i + 1}.</span> {s}
                                </div>
                              ))}
                            </div>
                            {toArr(tc.expectedResult).filter(Boolean).length > 0 && (
                              <div className={styles.detSection}>
                                <div className={styles.detLabel}>Expected Result</div>
                                <div className={styles.detVal}>
                                  {toArr(tc.expectedResult).filter(Boolean).map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {filteredTcs.length === 0 && (
                    <div className={styles.noTcs}>
                      {searchQuery ? 'No matching test cases' : 'No test cases'}
                    </div>
                  )}

                  {onTcAdd && (
                    <div style={{ padding: '4px 8px 6px' }}>
                      <button className="btn btn-sm" style={{ width: '100%' }} onClick={() => onTcAdd(mod)}>
                        <Icon name="add" />Add Test Case
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}
