// Assets/Editor/BuildBridge.cs
// UnityBridge.unity を Windows スタンドアロン(.exe)にビルドする。
// 実行: Unity.exe -batchmode -quit -projectPath <proj> -executeMethod BuildBridge.Build -logFile <log>
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class BuildBridge
{
    public static void Build()
    {
        var opts = new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Scenes/UnityBridge.unity" },
            locationPathName = "Build/UnityBridge/UnityBridge.exe",
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None,
        };

        BuildReport report = BuildPipeline.BuildPlayer(opts);
        BuildSummary summary = report.summary;

        if (summary.result == BuildResult.Succeeded)
        {
            Debug.Log("BUILD_OK bytes=" + summary.totalSize + " path=" + opts.locationPathName);
            EditorApplication.Exit(0);
        }
        else
        {
            Debug.LogError("BUILD_FAILED result=" + summary.result + " errors=" + summary.totalErrors);
            EditorApplication.Exit(1);
        }
    }
}
