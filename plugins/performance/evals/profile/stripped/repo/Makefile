CFLAGS_RELEASE = -O2
CFLAGS_DEBUG = -O0 -g

build/blend: blend.c
	mkdir -p build
	cc $(CFLAGS_RELEASE) -o $@ blend.c
	strip $@

debug: blend.c
	mkdir -p build
	cc $(CFLAGS_DEBUG) -o build/blend-debug blend.c

.PHONY: debug
