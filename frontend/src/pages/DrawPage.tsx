import { useParams } from 'react-router-dom'
import DrawingBoard from '../components/DrawingBoard'

export default function DrawPage() {
  const { pageId } = useParams<{ pageId: string }>()

  if (!pageId) {
    return <div style={{ padding: 16 }}>No page ID specified</div>
  }

  return <DrawingBoard pageId={pageId} />
}
