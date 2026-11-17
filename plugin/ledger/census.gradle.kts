// Census allow-list generator: applied from build.gradle.kts when this file exists.
val censusAllowlist = layout.projectDirectory.file("src/main/resources/ledger/census-allowlist.txt")
val censusTestSet = the<SourceSetContainer>()["test"]
val censusLauncher = the<JavaToolchainService>().launcherFor(the<JavaPluginExtension>().toolchain)

tasks.register<JavaExec>("generateCensusAllowlist") {
    group = "census"
    description = "Regenerates census-allowlist.txt from the pinned paper-api jar."
    classpath = censusTestSet.runtimeClasspath
    mainClass = "dev.geldar.ledger.paper.census.CensusAllowlistGenerator"
    args(censusAllowlist.asFile.absolutePath)
    javaLauncher = censusLauncher
}
