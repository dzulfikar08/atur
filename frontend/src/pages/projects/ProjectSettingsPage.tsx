import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  ArrowLeft, Settings, Users, Tag, Columns3, Palette, Plus, Trash2, Pencil,
} from 'lucide-react';

const STATE_GROUPS = [
  { value: 'backlog', label: 'Backlog', color: '#6b7280' },
  { value: 'unstarted', label: 'Todo', color: '#3b82f6' },
  { value: 'started', label: 'In Progress', color: '#f59e0b' },
  { value: 'completed', label: 'Done', color: '#22c55e' },
  { value: 'cancelled', label: 'Cancelled', color: '#ef4444' },
] as const;

const ROLE_LABELS: Record<number, string> = {
  5: 'Guest',
  10: 'Viewer',
  15: 'Member',
  20: 'Admin',
};

export default function ProjectSettingsPage() {
  const { slug, projectId } = useParams<{ slug: string; projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('general');

  // Queries
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', slug, projectId],
    queryFn: () => api.getProject(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const { data: states = [], isLoading: statesLoading } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const { data: labels = [], isLoading: labelsLoading } = useQuery({
    queryKey: ['labels', slug, projectId],
    queryFn: () => api.listLabels(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['project-members', slug, projectId],
    queryFn: () => api.listProjectMembers(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const { data: wsMembers = [] } = useQuery({
    queryKey: ['ws-members', slug],
    queryFn: () => api.listWorkspaceMembers(slug!),
    enabled: !!slug,
  });

  // General
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const updateProject = useMutation({
    mutationFn: (data: Record<string, string>) => api.updateProject(slug!, projectId!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', slug, projectId] }); toast.success('Project updated'); },
    onError: () => toast.error('Failed to update project'),
  });

  // States
  const [newStateName, setNewStateName] = useState('');
  const [newStateGroup, setNewStateGroup] = useState('unstarted');
  const createState = useMutation({
    mutationFn: (data: { name: string; group: string; color?: string }) => api.createState(slug!, projectId!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['states', slug, projectId] }); setNewStateName(''); toast.success('State created'); },
    onError: () => toast.error('Failed to create state'),
  });
  const deleteState = useMutation({
    mutationFn: (id: string) => api.deleteState(slug!, projectId!, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['states', slug, projectId] }); toast.success('State deleted'); },
    onError: () => toast.error('Failed to delete state'),
  });

  // Labels
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3b82f6');
  const createLabel = useMutation({
    mutationFn: (data: { name: string; color: string }) => api.createLabel(slug!, projectId!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['labels', slug, projectId] }); setNewLabelName(''); toast.success('Label created'); },
    onError: () => toast.error('Failed to create label'),
  });

  // Members
  const addMember = useMutation({
    mutationFn: (userId: string) => api.addProjectMember(slug!, projectId!, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-members', slug, projectId] }); toast.success('Member added'); },
    onError: () => toast.error('Failed to add member'),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeProjectMember(slug!, projectId!, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-members', slug, projectId] }); toast.success('Member removed'); },
    onError: () => toast.error('Failed to remove member'),
  });

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading project settings...</div>
      </div>
    );
  }

  const memberIds = new Set(members.map((m: any) => m.member?.id || m.id));
  const availableMembers = wsMembers.filter((m: any) => !memberIds.has(m.member?.id || m.id));

  const groupColor = (group: string) => STATE_GROUPS.find(g => g.value === group)?.color ?? '#6b7280';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/${slug}/projects/${projectId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">Project Settings</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="general"><Settings className="h-3.5 w-3.5 mr-1.5" />General</TabsTrigger>
          <TabsTrigger value="states"><Columns3 className="h-3.5 w-3.5 mr-1.5" />States</TabsTrigger>
          <TabsTrigger value="labels"><Tag className="h-3.5 w-3.5 mr-1.5" />Labels</TabsTrigger>
          <TabsTrigger value="members"><Users className="h-3.5 w-3.5 mr-1.5" />Members</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Update project name and details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Project Name</label>
                <Input
                  value={name || project?.name || ''}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Project name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Identifier</label>
                <Input value={project?.identifier || ''} disabled className="max-w-32" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Input
                  value={desc || project?.description || ''}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Project description"
                />
              </div>
              <Button
                onClick={() => {
                  const data: Record<string, string> = {};
                  if (name) data.name = name;
                  if (desc) data.description = desc;
                  updateProject.mutate(data);
                }}
                disabled={updateProject.isPending || (!name && !desc)}
              >
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* States */}
        <TabsContent value="states" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Columns3 className="h-4 w-4" /> Workflow States
              </CardTitle>
              <CardDescription>Manage the workflow states for this project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Create state */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
                  <Input placeholder="State name" value={newStateName} onChange={(e) => setNewStateName(e.target.value)} />
                </div>
                <div className="w-40">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Group</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={newStateGroup}
                    onChange={(e) => setNewStateGroup(e.target.value)}
                  >
                    {STATE_GROUPS.map(g => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={() => createState.mutate({ name: newStateName, group: newStateGroup })}
                  disabled={!newStateName.trim() || createState.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>

              {/* States list */}
              {statesLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
              ) : (
                <div className="space-y-1">
                  {STATE_GROUPS.map(group => {
                    const groupStates = states.filter(s => s.group === group.value);
                    if (groupStates.length === 0) return null;
                    return (
                      <div key={group.value}>
                        <div className="text-xs font-medium text-muted-foreground mt-3 mb-1 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
                          {group.label}
                        </div>
                        {groupStates.map(s => (
                          <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 group">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: s.color || group.color }} />
                              <span className="text-sm">{s.name}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                              onClick={() => { if (confirm(`Delete state "${s.name}"?`)) deleteState.mutate(s.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Labels */}
        <TabsContent value="labels" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-4 w-4" /> Labels
              </CardTitle>
              <CardDescription>Manage labels for this project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input placeholder="Label name" value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} />
                </div>
                <input
                  type="color"
                  value={newLabelColor}
                  onChange={(e) => setNewLabelColor(e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Button
                  onClick={() => createLabel.mutate({ name: newLabelName, color: newLabelColor })}
                  disabled={!newLabelName.trim() || createLabel.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>

              {labelsLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
              ) : labels.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No labels yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {labels.map((l: any) => (
                    <Badge
                      key={l.id}
                      className="cursor-default"
                      style={{
                        backgroundColor: (l.color || '#6b7280') + '20',
                        color: l.color || '#6b7280',
                        borderColor: l.color || '#6b7280',
                        border: '1px solid',
                      }}
                    >
                      {l.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" /> Members
              </CardTitle>
              <CardDescription>{members.length} members in this project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add member */}
              {availableMembers.length > 0 && (
                <div className="flex gap-2">
                  <select
                    id="member-select"
                    className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>Add a member...</option>
                    {availableMembers.map((m: any) => (
                      <option key={m.member?.id || m.id} value={m.member?.id || m.id}>
                        {m.member?.display_name || m.member?.username || m.member?.email}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() => {
                      const sel = document.getElementById('member-select') as HTMLSelectElement;
                      if (sel.value) addMember.mutate(sel.value);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />Add
                  </Button>
                </div>
              )}

              {membersLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
              ) : (
                <div className="space-y-1">
                  {members.map((m: any) => (
                    <div key={m.id || m.member?.id} className="flex items-center justify-between py-2 px-2 rounded hover:bg-muted/50 group">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {(m.member?.display_name || m.member?.username || 'U').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{m.member?.display_name || m.member?.username}</p>
                          <p className="text-xs text-muted-foreground">{m.member?.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{ROLE_LABELS[m.role] || `Role ${m.role}`}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Remove ${m.member?.display_name || 'member'}?`))
                              removeMember.mutate(m.member?.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
