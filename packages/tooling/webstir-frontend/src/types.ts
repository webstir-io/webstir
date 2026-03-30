export type FrontendPublishMode = 'bundle' | 'ssg';

export interface FrontendCommandOptions {
  readonly workspaceRoot: string;
  readonly changedFile?: string;
  readonly watch?: boolean;
  readonly publishMode?: FrontendPublishMode;
}

export interface FrontendConfig {
  readonly version: 1;
  readonly paths: FrontendPathConfig;
  readonly features: FrontendFeatureFlags;
}

export interface EnableFlags {
  readonly spa?: boolean;
  readonly clientNav?: boolean;
  readonly backend?: boolean;
  readonly search?: boolean;
  readonly contentNav?: boolean;
}

export interface FrontendPathConfig {
  readonly workspace: string;
  readonly src: {
    readonly root: string;
    readonly frontend: string;
    readonly app: string;
    readonly pages: string;
    readonly content: string;
    readonly images: string;
    readonly fonts: string;
    readonly media: string;
  };
  readonly build: {
    readonly root: string;
    readonly frontend: string;
    readonly app: string;
    readonly pages: string;
    readonly content: string;
    readonly images: string;
    readonly fonts: string;
    readonly media: string;
  };
  readonly dist: {
    readonly root: string;
    readonly frontend: string;
    readonly app: string;
    readonly pages: string;
    readonly content: string;
    readonly images: string;
    readonly fonts: string;
    readonly media: string;
  };
}

export interface FrontendFeatureFlags {
  readonly htmlSecurity: boolean;
  readonly externalResourceIntegrity: boolean;
  readonly imageOptimization: boolean;
  readonly precompression: boolean;
}

export interface AddPageCommandOptions extends FrontendCommandOptions {
  readonly pageName: string;
  readonly ssg?: boolean;
}

export interface FrontendWorkspaceKnownEnableFlags {
  readonly spa: boolean;
  readonly clientNav: boolean;
  readonly backend: boolean;
  readonly search: boolean;
  readonly contentNav: boolean;
}

export interface FrontendWorkspaceEnableFlagsInspect {
  readonly raw?: Record<string, unknown>;
  readonly known: FrontendWorkspaceKnownEnableFlags;
}

export interface FrontendWorkspacePackageInspect {
  readonly path: string;
  readonly exists: boolean;
  readonly mode?: string;
  readonly enable: FrontendWorkspaceEnableFlagsInspect;
}

export interface FrontendWorkspaceAppShellInspect {
  readonly root: string;
  readonly exists: boolean;
  readonly templatePath: string;
  readonly templateExists: boolean;
  readonly stylesheetPath: string;
  readonly stylesheetExists: boolean;
  readonly scriptPath: string;
  readonly scriptExists: boolean;
}

export interface FrontendWorkspacePageInspect {
  readonly name: string;
  readonly directory: string;
  readonly htmlPath: string;
  readonly htmlExists: boolean;
  readonly stylesheetPath: string;
  readonly stylesheetExists: boolean;
  readonly scriptPath: string;
  readonly scriptExists: boolean;
}

export interface FrontendWorkspaceContentInspect {
  readonly root: string;
  readonly exists: boolean;
  readonly sidebarOverridePath: string;
  readonly sidebarOverrideExists: boolean;
}

export interface FrontendWorkspaceInspectResult {
  readonly workspaceRoot: string;
  readonly config: FrontendConfig;
  readonly packageJson: FrontendWorkspacePackageInspect;
  readonly appShell: FrontendWorkspaceAppShellInspect;
  readonly pages: readonly FrontendWorkspacePageInspect[];
  readonly content: FrontendWorkspaceContentInspect;
}
