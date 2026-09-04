import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin)
    alias(libs.plugins.intellijPlatform)
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
    jvmToolchain(providers.gradleProperty("javaVersion").get().toInt())
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
        freeCompilerArgs.add("-Xjvm-default=all")
    }
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Built against the last separately published Community release rather than the
        // unified 2025.3 distribution: the APIs used are all older than 252, and compiling
        // against 252 is what makes `sinceBuild = 252` an honest claim. The plugin has no
        // upper bound, so it also loads in 2025.3 and later.
        intellijIdeaCommunity(providers.gradleProperty("platformVersion"))

        // The graph is built from the YAML PSI shipped with the IDE, so no YAML
        // parser is bundled into the plugin.
        bundledPlugin("org.jetbrains.plugins.yaml")

        pluginVerifier()
        zipSigner()
    }

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.snakeyaml)
    testRuntimeOnly(libs.junit.platform.launcher)
    testRuntimeOnly(libs.junit4)
}

intellijPlatform {
    pluginConfiguration {
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // No upper bound: the plugin uses long-stable platform APIs only.
            untilBuild = provider { null }
        }
    }

    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

// `examples/` and `conformance/` are shared with the other editors, so they sit at the repo
// root rather than inside this Gradle project.
val repoRoot: Directory = layout.projectDirectory.dir("../..")

tasks.runIde {
    // The sandbox IDE opens `examples/` as its project, so a launch lands straight on the
    // manual test plan instead of needing File -> Open every time. IntelliJ takes a directory
    // to open as its first program argument.
    args(repoRoot.dir("examples").asFile.absolutePath)

    // -PopenFile=<path relative to the repo root> also opens that file, so a launch can land
    // directly on the example being worked on.
    providers.gradleProperty("openFile").orNull?.let {
        args(repoRoot.file(it).asFile.absolutePath)
    }
}

// A single archive to hand to someone testing on another machine: the installable plugin,
// the examples to test it against, and the instructions. The plugin ZIP is nested rather than
// unpacked -- "Install Plugin from Disk" wants the archive exactly as the marketplace would
// see it, and unpacking it here would invite installing the wrong thing.
tasks.register<Zip>("packageTestKit") {
    group = "distribution"
    description = "Builds a testing bundle: the plugin ZIP, the examples, and TESTING.md."

    // One command produces a shippable bundle, and it cannot be produced from failing tests.
    dependsOn(tasks.test)

    val bundleName = "backstage-catalog-graph-$version-testkit"
    archiveFileName = "$bundleName.zip"
    destinationDirectory = layout.buildDirectory.dir("distributions")

    into(bundleName) {
        from(tasks.buildPlugin.flatMap { it.archiveFile })
        from(layout.projectDirectory.file("TESTING.md"))
        from(repoRoot.file("LICENSE"))
        from(repoRoot.dir("examples")) {
            into("examples")
            // The sandbox IDE writes a project directory into examples/ when it opens it.
            exclude(".idea")
        }
    }
}

tasks.test {
    useJUnitPlatform()
    // The example descriptors and the cross-editor conformance corpus are at the repo root.
    systemProperty("repo.root", repoRoot.asFile.absolutePath)
    // Regenerate the cross-editor golden files: -Dconformance.update=true
    providers.systemProperty("conformance.update").orNull?.let {
        systemProperty("conformance.update", it)
        outputs.upToDateWhen { false }
    }
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
