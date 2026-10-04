REPO ?= .
MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
.PHONY: ming han
ming han:
	@sh "$(MAKEFILE_DIR)switch-github.sh" "$@" "$(REPO)"
