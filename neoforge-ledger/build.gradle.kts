// Server-side NeoForge adapter for the loader-neutral ledger-core. Registers no payloads and no registry entries.
// NeoForge 26.1.2 (build 126) comes from ../neoforge/gradle.properties; there is no second copy.
import java.util.Properties

plugins {
    java
    id("net.neoforged.moddev")
}

version = "0.1.0"
group = "dev.geldar"

val neoforgeProps = Properties().apply {
    file("../neoforge/gradle.properties").inputStream().use { load(it) }
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    exclusiveContent {
        forRepository {
            mavenCentral()
        }
        filter {
            includeGroupAndSubgroups("org.junit")
            includeGroup("org.opentest4j")
            includeGroup("org.apiguardian")
            includeGroup("io.opentelemetry")
        }
    }
}

dependencyLocking {
    lockAllConfigurations()
    // Lenient: locked versions stay pinned, but a dependency missing from the lock no longer fails; strict cannot work because Linux resolves netty epoll natives a Windows lockfile lacks (verification-metadata.xml sha256 is the integrity guard).
    lockMode = LockMode.LENIENT
}

neoForge {
    version = neoforgeProps.getProperty("neoforge.version") ?: error("neoforge.version missing")

    runs {
        create("server") {
            server()
        }
    }

    mods {
        create("ledger") {
            sourceSet(sourceSets.main.get())
        }
    }
}

dependencies {
    // Jar-in-jar: the server has neither ledger-core nor the OpenTelemetry API. Strict ranges, because the jarjar
    // metadata records a version range.
    implementation("dev.geldar:ledger-core")
    // The range below is only the jar-in-jar metadata; the exact version is the preferred one (the plugin build
    // version here; for OpenTelemetry the catalog, gradle/libs.versions.toml). JarJarVersionTest keeps them in step.
    jarJar("dev.geldar:ledger-core") {
        version { strictly("[0.1,0.2)"); prefer("0.1.0") }
    }
    for (artifact in listOf("opentelemetry-api", "opentelemetry-common", "opentelemetry-context")) {
        // Range = jar-in-jar metadata only; the exact version is the preferred one, from the catalog (libs.versions.toml).
        jarJar("io.opentelemetry:$artifact") {
            version { strictly("[1.67,1.68)"); prefer("1.67.0") }
        }
    }
    implementation(libs.opentelemetry.api)

    // The curated family tests load NeoForge event classes (never started, no bootstrap), as the main code sees them.
    testImplementation(files(sourceSets.main.get().compileClasspath))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // JarContentTest opens the built mod jar (jar-in-jar content).
    dependsOn(tasks.jar)
    systemProperty("ledger.mod.jar", tasks.jar.get().archiveFile.get().asFile.absolutePath)
    // JarJarVersionTest compares the jar-in-jar metadata with the catalog and the plugin build version.
    systemProperty("ledger.catalog", file("gradle/libs.versions.toml").absolutePath)
    systemProperty("ledger.plugin.build", file("../plugin/build.gradle.kts").absolutePath)
    inputs.files("gradle/libs.versions.toml", "../plugin/build.gradle.kts")
    // The scan tests read these trees directly; declare them so an edit reruns the tests instead of being up to date.
    inputs.dir(layout.projectDirectory.dir("src/main"))
    inputs.dir(layout.projectDirectory.dir("../plugin/ledger-core/src/main"))
    inputs.files("gradle.properties", "../neoforge/gradle.properties", "gradle/wrapper/gradle-wrapper.properties", "../neoforge/gradle/wrapper/gradle-wrapper.properties")
    // NoLoaderImportsTest (mirror of the ledger-core test) walks the ledger-core tree for its own loader scan.
    systemProperty("ledger.core.src", file("../plugin/ledger-core/src").absolutePath)
}