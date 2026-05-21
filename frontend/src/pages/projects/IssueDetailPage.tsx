import { useWindowSize } from '@/hooks/useWindowSize';
import DesktopIssueDetail from '@/components/issues/IssueDetail';
import MobileIssueDetail from '@/components/mobile/MobileIssueDetail';

export default function IssueDetailPage() {
  const { width } = useWindowSize();

  if (width < 768) {
    return <MobileIssueDetail />;
  }

  return <DesktopIssueDetail />;
}
