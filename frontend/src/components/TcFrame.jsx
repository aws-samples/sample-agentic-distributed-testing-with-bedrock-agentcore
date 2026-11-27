import { useEffect, useState } from 'react'
import { useApi } from '../context/useApi'
import styles from './TcFrame.module.css'

// What the agent saw: the feature's live browser frame while the case runs, and the last frame the
// agent produced once it has finished (kept by the backend, see GET /api/tests/frame/:tcId).
export default function TcFrame({ tcId, status, liveScreenshot }) {
  const api = useApi()
  const [last, setLast] = useState(null)

  useEffect(() => {
    if (status === 'RUNNING' || status === 'PENDING') { setLast(null); return undefined }
    let off = false
    api.getLastFrame(tcId).then(r => { if (!off) setLast(r.data) }).catch(() => { if (!off) setLast(null) })
    return () => { off = true }
  }, [tcId, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const running = status === 'RUNNING'
  const data = running ? liveScreenshot : last
  return (
    <div className={styles.frame}>
      <div className={styles.label}>{running ? 'LIVE BROWSER' : 'LAST FRAME'}</div>
      {data
        ? <img src={`data:image/jpeg;base64,${data}`} alt={`${running ? 'Live browser' : 'Last browser frame'} for ${tcId}`} />
        : <div className={styles.none}>{running ? 'Waiting for the first frame…' : 'No frame was kept for this case.'}</div>}
    </div>
  )
}
