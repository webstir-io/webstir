using System;
using System.IO;
using System.Threading;
using Utilities.Process;
using Tester.Infrastructure;
using Xunit;

namespace Tester.FrameworkPackages;

[Collection("PackageAutomationNonParallel")]
public sealed class PackageAutomationIntegrationTests
{
    [Fact]
    public void ReleaseCommandIsBlockedInCanonicalMonorepoWorkspace()
    {
        using PackageCliWorkspace workspace = PackageCliWorkspace.Create("release-blocked");
        workspace.MarkAsCanonicalMonorepo();

        ProcessResult result = workspace.RunFramework("-- packages release --dry-run", timeoutMs: 25000);
        Assert.Equal(1, result.ExitCode);

        string output = string.Concat(result.StandardOutput, result.StandardError);
        Assert.Contains("framework packages release is unavailable", output, StringComparison.Ordinal);
        Assert.Contains("packages/**", output, StringComparison.Ordinal);
        Assert.Contains("sync:framework-embedded", output, StringComparison.Ordinal);
    }

    [Fact]
    public void PublishCommandIsBlockedInCanonicalMonorepoWorkspace()
    {
        using PackageCliWorkspace workspace = PackageCliWorkspace.Create("publish-blocked");
        workspace.MarkAsCanonicalMonorepo();

        ProcessResult result = workspace.RunFramework("-- packages publish --dry-run --all", timeoutMs: 30000);
        Assert.Equal(1, result.ExitCode);

        string output = string.Concat(result.StandardOutput, result.StandardError);
        Assert.Contains("framework packages publish is unavailable", output, StringComparison.Ordinal);
        Assert.Contains("packages/**", output, StringComparison.Ordinal);
        Assert.Contains("sync:framework-embedded", output, StringComparison.Ordinal);
    }

    private sealed class PackageCliWorkspace : IDisposable
    {
        private PackageCliWorkspace(string repositoryRoot)
        {
            RepositoryRoot = repositoryRoot;
        }

        public string RepositoryRoot
        {
            get;
        }

        public static PackageCliWorkspace Create(string scenarioName)
        {
            string root = Directory.CreateDirectory(
                Path.Combine(Path.GetTempPath(), "webstir-tests", "package-automation", $"repo-{scenarioName}-{Guid.NewGuid():N}")).FullName;

            string sourceRoot = RepositoryRootLocator.Resolve();
            CopyDirectory(Path.Combine(sourceRoot, "Framework"), Path.Combine(root, "Framework"));
            CopyDirectory(Path.Combine(sourceRoot, "Utilities"), Path.Combine(root, "Utilities"));
            InitializeGit(root);

            return new PackageCliWorkspace(root);
        }

        public void MarkAsCanonicalMonorepo()
        {
            WriteFile(Path.Combine(".github", "workflows", "release-package.yml"), "name: Release Package\n");
            WriteFile(Path.Combine("packages", "contracts", "module-contract", "package.json"), "{ \"name\": \"@webstir-io/module-contract\" }\n");
            WriteFile(Path.Combine("packages", "tooling", "webstir-frontend", "package.json"), "{ \"name\": \"@webstir-io/webstir-frontend\" }\n");
        }

        public ProcessResult RunFramework(string arguments, int timeoutMs)
        {
            ProcessRunner runner = new();
            ProcessSpec spec = new()
            {
                FileName = "dotnet",
                Arguments = $"run --project Framework/Framework.csproj -- {arguments.Trim()}",
                WorkingDirectory = RepositoryRoot,
                ExitTimeout = timeoutMs > 0 ? TimeSpan.FromMilliseconds(timeoutMs) : null,
                TerminationMethod = TerminationMethod.Kill,
                RedirectStandardInput = false,
                WaitForReadySignalOnStart = false
            };

            return runner.RunAsync(spec, CancellationToken.None).GetAwaiter().GetResult();
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(RepositoryRoot))
                {
                    Directory.Delete(RepositoryRoot, recursive: true);
                }
            }
            catch
            {
                // Ignore cleanup failures.
            }
        }

        private static void InitializeGit(string root)
        {
            RunGit(root, "init");
            RunGit(root, "config user.email test@example.com");
            RunGit(root, "config user.name Webstir Tests");
            RunGit(root, "add .");
            RunGit(root, "commit -m \"initial\" --allow-empty");
        }

        private void WriteFile(string relativePath, string contents)
        {
            string fullPath = Path.Combine(RepositoryRoot, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            File.WriteAllText(fullPath, contents);
        }

        private static void RunGit(string workingDirectory, string arguments)
        {
            System.Diagnostics.ProcessStartInfo startInfo = new()
            {
                FileName = "git",
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using System.Diagnostics.Process process = new()
            {
                StartInfo = startInfo
            };
            process.Start();
            string stdout = process.StandardOutput.ReadToEnd();
            string stderr = process.StandardError.ReadToEnd();
            bool exited = process.WaitForExit(15000);

            if (!exited)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch { }
            }

            Assert.True(exited, $"git {arguments} timed out");
            Assert.Equal(0, process.ExitCode); // propagate failure context
        }

        private static void CopyDirectory(string source, string destination)
        {
            Directory.CreateDirectory(destination);

            foreach (string directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
            {
                if (ShouldSkip(directory))
                {
                    continue;
                }

                string relative = Path.GetRelativePath(source, directory);
                Directory.CreateDirectory(Path.Combine(destination, relative));
            }

            foreach (string file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                if (ShouldSkip(file))
                {
                    continue;
                }

                string relative = Path.GetRelativePath(source, file);
                string target = Path.Combine(destination, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(file, target, overwrite: true);
            }
        }

        private static bool ShouldSkip(string path)
        {
            string normalized = path.Replace('\\', Path.DirectorySeparatorChar).Replace('/', Path.DirectorySeparatorChar);
            foreach (string segment in normalized.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
            {
                if (segment.Equals("bin", StringComparison.OrdinalIgnoreCase) ||
                    segment.Equals("obj", StringComparison.OrdinalIgnoreCase) ||
                    segment.Equals(".git", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
