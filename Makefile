# Local build, package and hands-on testing for both editors.
#
# CI does not use this file -- the workflows call Gradle and npm directly -- so it is purely a
# convenience over the commands in CLAUDE.md. `make` alone lists the targets.

JETBRAINS := editors/jetbrains
VSCODE    := editors/vscode
GRADLE    := cd $(JETBRAINS) && ./gradlew
DIST      := dist

# The file each editor opens on launch, relative to the repository root.
FILE ?= examples/08-large-catalog/catalog-info.yaml

# A throwaway VS Code profile, so a packaged .vsix is tried without touching your own setup.
VSCODE_PROFILE := $(CURDIR)/build/vscode-profile

VERSION := $(shell node -p "require('./$(VSCODE)/package.json').version" 2>/dev/null)
VSIX    := $(VSCODE)/backstage-catalog-graph-$(VERSION).vsix
# Gradle leaves earlier versions' zips in build/distributions, so name this one exactly.
JETBRAINS_VERSION := $(shell sed -n 's/^pluginVersion *= *//p' $(JETBRAINS)/gradle.properties)
PLUGIN_ZIP := $(JETBRAINS)/build/distributions/backstage-catalog-graph-$(JETBRAINS_VERSION).zip

.DEFAULT_GOAL := help

.PHONY: help build test package clean \
        jetbrains-build jetbrains-test jetbrains-package jetbrains-testkit run-jetbrains verify-jetbrains \
        vscode-build vscode-test vscode-package run-vscode run-vscode-package

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "  FILE=<path> picks the file the run targets open (default: $(FILE))"

# --- Both editors ------------------------------------------------------------------------------

build: jetbrains-build vscode-build ## Compile and test both editors

test: jetbrains-test vscode-test ## Run both test suites, conformance corpus included

package: jetbrains-package vscode-package ## Build both installable packages into dist/
	@echo
	@ls -1 $(DIST)

clean: ## Remove build output and packages
	$(GRADLE) clean
	rm -rf $(VSCODE)/out $(VSCODE)/out-test $(VSCODE)/*.vsix $(DIST) $(VSCODE_PROFILE)

# --- JetBrains ---------------------------------------------------------------------------------

jetbrains-build: ## Compile and test the JetBrains plugin
	$(GRADLE) build

jetbrains-test: ## Run the JetBrains tests
	$(GRADLE) test

jetbrains-package: ## Build the JetBrains plugin zip into dist/
	$(GRADLE) buildPlugin
	@mkdir -p $(DIST)
	cp $(PLUGIN_ZIP) $(DIST)/
	@echo "Install it in an IDE with Settings > Plugins > (gear) > Install Plugin from Disk..."

jetbrains-testkit: ## Bundle plugin, examples and TESTING.md into dist/, for another machine
	$(GRADLE) packageTestKit
	@mkdir -p $(DIST)
	cp $(JETBRAINS)/build/distributions/backstage-catalog-graph-$(JETBRAINS_VERSION)-testkit.zip $(DIST)/

verify-jetbrains: ## Run the JetBrains plugin verifier against real IDE builds
	$(GRADLE) verifyPlugin

# A second runIde while a sandbox is open is handed to that instance and exits at once, leaving
# the old plugin loaded -- so refuse rather than appear to work. The bracket keeps the pattern
# from matching this recipe's own shell, whose command line contains the pattern's text.
run-jetbrains: ## Launch a sandbox IDE with the plugin, opening FILE
	@if pgrep -f '[i]ntellijPlatform/sandbox' >/dev/null; then \
		echo "A sandbox IDE is already running; close it first, or it keeps the old plugin."; \
		exit 1; \
	fi
	$(GRADLE) runIde -PopenFile=$(FILE)

# --- VS Code -----------------------------------------------------------------------------------

$(VSCODE)/node_modules: $(VSCODE)/package-lock.json
	cd $(VSCODE) && npm ci
	@touch $@

vscode-build: $(VSCODE)/node_modules ## Compile, test and bundle the VS Code extension
	cd $(VSCODE) && npm test && npm run bundle

vscode-test: $(VSCODE)/node_modules ## Run the VS Code tests
	cd $(VSCODE) && npm test

vscode-package: $(VSCODE)/node_modules ## Build the VS Code .vsix into dist/
	cd $(VSCODE) && npm run package
	@mkdir -p $(DIST)
	cp $(VSIX) $(DIST)/

# Runs the source tree. After rebuilding, use Developer: Reload Window in that window -- VS Code
# does not re-read the bundle on its own.
run-vscode: $(VSCODE)/node_modules ## Launch an Extension Development Host from source, opening FILE
	cd $(VSCODE) && npm run bundle
	code --extensionDevelopmentPath="$(CURDIR)/$(VSCODE)" --new-window examples $(FILE)

# Installs the packaged .vsix into a throwaway profile: tests exactly what would be published,
# minified bundle and all, without the extension ending up in your own VS Code.
run-vscode-package: vscode-package ## Install the .vsix in a throwaway profile and open FILE
	code --user-data-dir "$(VSCODE_PROFILE)/data" --extensions-dir "$(VSCODE_PROFILE)/extensions" \
		--install-extension $(VSIX) --force
	code --user-data-dir "$(VSCODE_PROFILE)/data" --extensions-dir "$(VSCODE_PROFILE)/extensions" \
		--new-window examples $(FILE)
