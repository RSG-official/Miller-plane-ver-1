// miller.cpp
// Core Miller-index <-> intercept math, compiled to WebAssembly with Emscripten.
// This is the same integer GCD/LCM logic as the original Android app,
// just ported from Java to C++.

#include <emscripten/emscripten.h>

extern "C" {

static int gcd_(int a, int b) {
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    while (b != 0) {
        int t = b;
        b = a % b;
        a = t;
    }
    return a;
}

static int lcm_(int a, int b) {
    if (a == 0 || b == 0) return a ? a : b;
    long long result = ((long long)a * (long long)b) / gcd_(a, b);
    if (result < 0) result = -result;
    return (int)result;
}

EMSCRIPTEN_KEEPALIVE
int compute_gcd(int a, int b) { return gcd_(a, b); }

EMSCRIPTEN_KEEPALIVE
int compute_lcm(int a, int b) { return lcm_(a, b); }

// Converts three integer intercepts (p, q, r) to Miller indices (h, k, l).
// A value of 0 means "the plane does not cross this axis" (parallel to it).
// Results are written through the pointers. Returns 0 on success,
// -1 if p == q == r == 0 (no valid plane).
EMSCRIPTEN_KEEPALIVE
int intercepts_to_miller(int p, int q, int r, int* h, int* k, int* l) {
    if (p == 0 && q == 0 && r == 0) return -1;

    int hasP = 1, hasQ = 1, hasR = 1;
    int i = p, j = q, m = r;
    if (p == 0) { hasP = 0; i = 1; }
    if (q == 0) { hasQ = 0; j = 1; }
    if (r == 0) { hasR = 0; m = 1; }

    int L = lcm_(lcm_(i, j), m);

    *h = hasP ? L / i : 0;
    *k = hasQ ? L / j : 0;
    *l = hasR ? L / m : 0;
    return 0;
}

// Given one Miller index, returns the intercept along that axis (in units
// of the lattice parameter). Index 0 means "parallel" -- represented here
// as a large sentinel value (1e18) since WASM/JS doesn't need real Infinity
// to cross the C ABI cleanly.
EMSCRIPTEN_KEEPALIVE
double miller_axis_intercept(int index) {
    if (index == 0) return 1e18;
    return 1.0 / (double)index;
}

} // extern "C"
