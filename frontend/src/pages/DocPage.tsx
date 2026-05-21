import { useParams } from 'react-router-dom'
import DocEditor from '../components/DocEditor'

export default function DocPage() {
  const { pageId } = useParams<{ pageId: string }>()

  if (!pageId) {
    return <div className="p-4">No page ID specified</div>
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <DocEditor pageId={pageId} />
    </div>
  )
}
