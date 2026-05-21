use crate::types::Role;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionLevel {
    Workspace,
    Project,
}

#[derive(Debug, Clone)]
pub struct PermissionCheck {
    pub level: PermissionLevel,
    pub min_role: Role,
}

impl PermissionCheck {
    pub fn workspace(min_role: Role) -> Self {
        Self { level: PermissionLevel::Workspace, min_role }
    }

    pub fn project(min_role: Role) -> Self {
        Self { level: PermissionLevel::Project, min_role }
    }

    pub fn is_allowed(&self, user_role: Role) -> bool {
        user_role.as_u8() >= self.min_role.as_u8()
    }
}

pub const WORKSPACE_READ: PermissionCheck = PermissionCheck {
    level: PermissionLevel::Workspace,
    min_role: Role::Guest,
};

pub const WORKSPACE_WRITE: PermissionCheck = PermissionCheck {
    level: PermissionLevel::Workspace,
    min_role: Role::Member,
};

pub const WORKSPACE_ADMIN: PermissionCheck = PermissionCheck {
    level: PermissionLevel::Workspace,
    min_role: Role::Admin,
};

pub const PROJECT_READ: PermissionCheck = PermissionCheck {
    level: PermissionLevel::Project,
    min_role: Role::Guest,
};

pub const PROJECT_WRITE: PermissionCheck = PermissionCheck {
    level: PermissionLevel::Project,
    min_role: Role::Member,
};

pub const PROJECT_ADMIN: PermissionCheck = PermissionCheck {
    level: PermissionLevel::Project,
    min_role: Role::Admin,
};
