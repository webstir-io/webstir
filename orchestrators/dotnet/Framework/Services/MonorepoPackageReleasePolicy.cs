using System;
using System.IO;

namespace Framework.Services;

internal interface IMonorepoPackageReleasePolicy
{
    bool IsCanonicalMonorepo(string repositoryRoot);

    void EnsureCommandSupported(string repositoryRoot, string command);
}

internal sealed class MonorepoPackageReleasePolicy : IMonorepoPackageReleasePolicy
{
    public bool IsCanonicalMonorepo(string repositoryRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);

        return File.Exists(Path.Combine(repositoryRoot, "packages", "contracts", "module-contract", "package.json"))
            && File.Exists(Path.Combine(repositoryRoot, "packages", "tooling", "webstir-frontend", "package.json"))
            && File.Exists(Path.Combine(repositoryRoot, ".github", "workflows", "release-package.yml"));
    }

    public void EnsureCommandSupported(string repositoryRoot, string command)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);
        ArgumentException.ThrowIfNullOrWhiteSpace(command);

        if (!IsCanonicalMonorepo(repositoryRoot))
        {
            return;
        }

        if (!command.Equals("release", StringComparison.OrdinalIgnoreCase)
            && !command.Equals("publish", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        throw new InvalidOperationException(
            $"framework packages {command} is unavailable in the canonical webstir monorepo. " +
            "Release npm packages from the canonical packages/** directories with their npm run release helpers " +
            "or trigger the Release Package GitHub workflow, then run pnpm run sync:framework-embedded if needed.");
    }
}
