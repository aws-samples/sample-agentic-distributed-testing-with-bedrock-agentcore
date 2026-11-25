import { useState, useEffect, useRef } from 'react'
import styles from './FeaturePanel.module.css'
import Icon from './Icon'

function toArr(v) {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

// The + on a feature header when there is more than one way to add a test case.
// A menu button: Enter / Space / ArrowDown opens it on the first item, arrows move,
// Escape closes it and returns focus to the button, Tab or a click outside closes it.
function AddMenu({ feat, choices, onPick }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const itemRefs = useRef([])

  useEffect(() => {
    if (!open) return
    itemRefs.current[0]?.focus()
    const onDocDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const close = (refocus) => { setOpen(false); if (refocus) btnRef.current?.focus() }
  const pick = (kind) => { setOpen(false); onPick(kind) }

  const onMenuKey = (e) => {
    e.stopPropagation()
    const items = itemRefs.current.filter(Boolean)
    const i = items.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <span className={styles.addMenuWrap} ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        ref={btnRef}
        className={styles.featIconBtn}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) } }}
        title="Add test case"
        aria-label={`Add test case to ${feat}`}
        aria-haspopup="menu"
        aria-expanded={open}
      ><Icon name="add" size={15} /></button>
      {open && (
        <div className={styles.addMenu} role="menu" aria-label={`Add test case to ${feat}`} onKeyDown={onMenuKey}>
          {choices.map((c, i) => (
            <button
              key={c.kind}
              type="button"
              role="menuitem"
              ref={el => { itemRefs.current[i] = el }}
              className={styles.addMenuItem}
              title={c.title}
              onClick={() => pick(c.kind)}
            >
              {c.icon && <Icon name={c.icon} size={15} />}{c.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/**
 * Shared left panel — Runner, Editor, Focus Modal.
 *
 * showSessionIndicators  runner/focus: connected/running dot
 * showStatusBadges       runner/focus: PASS/FAIL badge on TC rows
 * showTcDetail           runner/focus: TC rows are expanders; clicking expands
 *                         a read-only detail pane inline. Includes Expand All /
 *                         Collapse All controls in the filter bar.
 * onFeatureEdit           editor: pencil on the feature header (rename / edit Background / delete)
 * onTcAdd                editor: + on the feature header adds a test case to that feature
 *
 * expandedFeature         editor: controlled single-feature expansion
 *                        runner/focus: ignored — panel manages its own Set
 */
export default function FeaturePanel({
  style,
  features = [],
  testCases = {},
  testResults = {},
  sessionStatus = {},
  activeFeatures,
  // Editor-controlled expansion: single string OR Set of names
  expandedFeature,
  expandedFeatures, // Set<string> — takes priority over expandedFeature when provided
  selectedTcId: externalSelectedTcId,
  // Callbacks
  onFeatureClick,
  onTcClick,
  onFeatureEdit,
  onTcAdd,
  tcAddChoices,  // editor: [{ kind, label, icon }] — + opens a menu and calls onTcAdd(feat, kind)
  onExpandAll,   // editor: called to expand all features
  onCollapseAll, // editor: called to collapse all features
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
  // When a single feature is pre-selected (e.g. FocusModal), start it expanded
  const [expandedFeats, setExpandedFeats] = useState(
    () => showTcDetail && expandedFeature ? new Set([expandedFeature]) : new Set()
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

  // Feature expansion: if showTcDetail, use internal Set; else use prop (Set or string)
  const isFeatExpanded = (feat) => showTcDetail
    ? expandedFeats.has(feat)
    : expandedFeatures
      ? expandedFeatures.has(feat)
      : expandedFeature === feat

  const handleFeatureClick = (feat) => {
    if (showTcDetail) {
      setExpandedFeats(prev => {
        const next = new Set(prev)
        next.has(feat) ? next.delete(feat) : next.add(feat)
        return next
      })
    }
    onFeatureClick?.(feat)
  }

  // TC expansion (only when showTcDetail)
  const handleTcClick = (tcId, feat) => {
    if (showTcDetail) {
      setExpandedTcs(prev => {
        const next = new Set(prev)
        next.has(tcId) ? next.delete(tcId) : next.add(tcId)
        return next
      })
    }
    onTcClick?.(tcId, feat)
  }

  const allTcIds = () => Object.values(testCases).flat().map(t => t.id)

  // Runner: expand/collapse only features (not TC detail panes)
  const expandAll = () => {
    if (showTcDetail) {
      setExpandedFeats(new Set(features))
      // Don't auto-expand TC detail panes — user opens those explicitly
    } else if (onExpandAll) {
      onExpandAll()
    }
  }
  const collapseAll = () => {
    if (showTcDetail) {
      setExpandedFeats(new Set())
      setExpandedTcs(new Set())
    } else if (onCollapseAll) {
      onCollapseAll()
    }
  }

  // One button toggles: collapse when every feature is open, otherwise expand all.
  const allExpanded = features.length > 0 && features.every(f => isFeatExpanded(f))

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
          <button
            type="button"
            className={styles.expandBtn}
            onClick={allExpanded ? collapseAll : expandAll}
            disabled={features.length === 0}
            title={allExpanded ? 'Collapse all features' : 'Expand all features'}
            aria-label={allExpanded ? 'Collapse all features' : 'Expand all features'}
          >
            <Icon name={allExpanded ? 'unfold_less' : 'unfold_more'} size={16} />
          </button>
        )}
      </div>

      <div className={styles.list}>
        {features.length === 0 && <div className={styles.empty}>No features</div>}

        {features.map((feat, idx) => {
          const tcs = testCases[feat] || []
          const sess = sessionStatus[feat] || {}
          const isRunning = activeFeatures?.has(feat)
          const featExpanded = isFeatExpanded(feat)

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
            <div key={feat} className={styles.group}>
              <div
                className={`${styles.featureHeader}${featExpanded ? ' ' + styles.featureHeaderActive : ''}`}
                onClick={() => handleFeatureClick(feat)}
              >
                {showTcDetail && (
                  <span className={styles.chevron}>{featExpanded ? '▾' : '▸'}</span>
                )}
                {showSessionIndicators && <div className={indClass} />}
                <span className={styles.featName}>{feat}</span>
                <span className={styles.count}>{tcs.length}</span>
                {(onFeatureEdit || onTcAdd) && (
                  <div className={styles.featureActions}>
                    {onFeatureEdit && (
                      <button
                        type="button"
                        className={styles.featIconBtn}
                        onClick={(e) => { e.stopPropagation(); onFeatureEdit(feat) }}
                        title="Edit feature"
                        aria-label={`Edit feature ${feat}`}
                      ><Icon name="edit" size={14} /></button>
                    )}
                    {onTcAdd && tcAddChoices && (
                      <AddMenu feat={feat} choices={tcAddChoices} onPick={(kind) => onTcAdd(feat, kind)} />
                    )}
                    {onTcAdd && !tcAddChoices && (
                      <button
                        type="button"
                        className={styles.featIconBtn}
                        onClick={(e) => { e.stopPropagation(); onTcAdd(feat) }}
                        title="Add test case"
                        aria-label={`Add test case to ${feat}`}
                      ><Icon name="add" size={15} /></button>
                    )}
                  </div>
                )}
              </div>

              {featExpanded && (
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
                          onClick={() => handleTcClick(tc.id, feat)}
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
                            {toArr(tc.given).filter(Boolean).length > 0 && (
                              <div className={styles.detSection}>
                                <div className={styles.detLabel}>Given</div>
                                <div className={styles.detVal}>
                                  {toArr(tc.given).filter(Boolean).map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
                                </div>
                              </div>
                            )}
                            <div className={styles.detSection}>
                              <div className={styles.detLabel}>When</div>
                              {(tc.when || []).map((s, i) => (
                                <div key={i} className={styles.detStep}>
                                  <span className={styles.detStepNum}>{i + 1}.</span> {s}
                                </div>
                              ))}
                            </div>
                            {toArr(tc.then).filter(Boolean).length > 0 && (
                              <div className={styles.detSection}>
                                <div className={styles.detLabel}>Then</div>
                                <div className={styles.detVal}>
                                  {toArr(tc.then).filter(Boolean).map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
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
