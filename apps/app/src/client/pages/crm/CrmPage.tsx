import { Link, useParams } from "react-router-dom";
import { Users, FolderKanban, Mail } from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";

export default function CrmPage() {
  const { slug } = useParams();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CRM</h1>
        <p className="text-muted-foreground text-sm">Contacts, leads, and sales pipelines.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to={`/${slug}/crm/contacts`}>
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex items-center gap-4">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="font-semibold">Contacts</p>
                <p className="text-sm text-muted-foreground">Leads &amp; customers</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to={`/${slug}/crm/pipelines`}>
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex items-center gap-4">
              <FolderKanban className="h-8 w-8 text-primary" />
              <div>
                <p className="font-semibold">Pipelines</p>
                <p className="text-sm text-muted-foreground">Sales deal boards</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to={`/${slug}/crm/email-templates`}>
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex items-center gap-4">
              <Mail className="h-8 w-8 text-primary" />
              <div>
                <p className="font-semibold">Email Templates</p>
                <p className="text-sm text-muted-foreground">Customer communication</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
