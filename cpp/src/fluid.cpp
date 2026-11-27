// Smoothed-particle hydrodynamics (SPH) in a cylindrical beaker, with per-particle chemical species.
#include "fluid.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace {
constexpr float PI = 3.14159265358979f;
constexpr int MAX_SPECIES = 16;

struct Reaction { int ra = 0, rb = 0; float prob = 0.f; bool valid = false; };

struct Sim {
    int cap, n = 0;
    float R, H;
    float h = 0.16f;        // smoothing radius
    float s = 0.08f;        // rest spacing (h/2)
    float mass = 1.f, rho0 = 1.f;
    float gravity = 4.0f;   // simulation units (visual scale)
    float stiffness = 110.f;
    float visc = 9.0f;
    float ymax = 3.5f;
    float lastMeanDensity = 0.f;
    uint32_t rng = 2463534242u;

    std::vector<float> pos, vel, acc, rho, prs;
    std::vector<uint8_t> sp, changed;
    float grav[MAX_SPECIES], viscS[MAX_SPECIES];
    Reaction rx[MAX_SPECIES][MAX_SPECIES];

    // uniform grid
    int gx = 0, gy = 0, gz = 0;
    float ox = 0, oy = 0, oz = 0;
    std::vector<int> cellStart, cellItems, cellOf;

    Sim(int maxp, float r, float hh) : cap(maxp), R(r), H(hh) {
        pos.assign(3 * cap, 0); vel.assign(3 * cap, 0); acc.assign(3 * cap, 0);
        rho.assign(cap, 0); prs.assign(cap, 0); sp.assign(cap, 0); changed.assign(cap, 0);
        for (int i = 0; i < MAX_SPECIES; i++) { grav[i] = 1.f; viscS[i] = 1.f; }
        ox = -R - 2 * h; oy = -h; oz = -R - 2 * h;
        gx = (int)std::ceil((2 * R + 4 * h) / h) + 1;
        gy = (int)std::ceil((ymax + 2 * h) / h) + 1;
        gz = gx;
        cellStart.assign(gx * gy * gz + 1, 0);
        cellOf.assign(cap, 0);
        cellItems.assign(cap, 0);
        rho0 = latticeDensity();
    }

    float rnd() {  // xorshift32 in [0,1)
        rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
        return (rng & 0xFFFFFF) / 16777216.f;
    }

    float poly6(float r2) const {
        float d = h * h - r2;
        return d > 0 ? 315.f / (64.f * PI * std::pow(h, 9)) * d * d * d : 0.f;
    }

    float latticeDensity() const {  // density of a perfect lattice at spacing s
        float sum = 0;
        for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) for (int k = -4; k <= 4; k++)
            sum += mass * poly6(s * s * (i * i + j * j + k * k));
        return sum;
    }

    void buildGrid() {
        std::fill(cellStart.begin(), cellStart.end(), 0);
        for (int i = 0; i < n; i++) {
            int cx = std::clamp((int)((pos[3 * i] - ox) / h), 0, gx - 1);
            int cy = std::clamp((int)((pos[3 * i + 1] - oy) / h), 0, gy - 1);
            int cz = std::clamp((int)((pos[3 * i + 2] - oz) / h), 0, gz - 1);
            int c = (cy * gz + cz) * gx + cx;
            cellOf[i] = c;
            cellStart[c + 1]++;
        }
        for (size_t c = 1; c < cellStart.size(); c++) cellStart[c] += cellStart[c - 1];
        std::vector<int> fill(cellStart.begin(), cellStart.end() - 1);
        for (int i = 0; i < n; i++) cellItems[fill[cellOf[i]]++] = i;
    }

    template <class F> void forNeighbors(int i, F&& f) const {
        int c = cellOf[i];
        int cx = c % gx, cz = (c / gx) % gz, cy = c / (gx * gz);
        for (int y = std::max(cy - 1, 0); y <= std::min(cy + 1, gy - 1); y++)
            for (int z = std::max(cz - 1, 0); z <= std::min(cz + 1, gz - 1); z++)
                for (int x = std::max(cx - 1, 0); x <= std::min(cx + 1, gx - 1); x++) {
                    int cc = (y * gz + z) * gx + x;
                    for (int k = cellStart[cc]; k < cellStart[cc + 1]; k++) f(cellItems[k]);
                }
    }

    int step(float dt, float stir, float temperature) {
        if (n == 0) return 0;
        buildGrid();
        const float h2 = h * h;
        const float reactR2 = (1.25f * s) * (1.25f * s);
        const float tempFactor = std::exp((temperature - 25.f) / 40.f);
        int events = 0;
        std::fill(changed.begin(), changed.begin() + n, 0);

        // 1) density, pressure, reactions
        double meanRho = 0;
        for (int i = 0; i < n; i++) {
            float xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
            float d = 0;
            forNeighbors(i, [&](int j) {
                float dx = xi - pos[3 * j], dy = yi - pos[3 * j + 1], dz = zi - pos[3 * j + 2];
                float r2 = dx * dx + dy * dy + dz * dz;
                if (r2 < h2) d += mass * poly6(r2);
                if (j > i && r2 < reactR2 && !changed[i] && !changed[j]) {
                    const Reaction& r = rx[sp[i]][sp[j]];
                    if (r.valid && rnd() < r.prob * tempFactor) {
                        sp[i] = (uint8_t)r.ra; sp[j] = (uint8_t)r.rb;
                        changed[i] = changed[j] = 1;
                        events++;
                    }
                }
            });
            rho[i] = d;
            prs[i] = std::max(0.f, stiffness * (d - rho0));
            meanRho += d;
        }
        lastMeanDensity = (float)(meanRho / n);

        // 2) forces
        const float spikyC = -45.f / (PI * std::pow(h, 6));
        const float viscC = 45.f / (PI * std::pow(h, 6));
        const float tempVisc = 1.f / (1.f + std::max(0.f, temperature - 25.f) / 60.f);
        for (int i = 0; i < n; i++) {
            float xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
            float fx = 0, fy = 0, fz = 0;
            float vi_s = viscS[sp[i]];
            forNeighbors(i, [&](int j) {
                if (j == i) return;
                float dx = xi - pos[3 * j], dy = yi - pos[3 * j + 1], dz = zi - pos[3 * j + 2];
                float r2 = dx * dx + dy * dy + dz * dz;
                if (r2 >= h2 || r2 < 1e-12f) return;
                float r = std::sqrt(r2);
                float q = h - r;
                float pf = -mass * (prs[i] + prs[j]) / (2.f * rho[j]) * spikyC * q * q / r;
                fx += pf * dx; fy += pf * dy; fz += pf * dz;
                float vf = visc * tempVisc * 0.5f * (vi_s + viscS[sp[j]]) * mass * viscC * q / rho[j];
                fx += vf * (vel[3 * j] - vel[3 * i]);
                fy += vf * (vel[3 * j + 1] - vel[3 * i + 1]);
                fz += vf * (vel[3 * j + 2] - vel[3 * i + 2]);
            });
            float inv = 1.f / rho[i];
            float ax = fx * inv, ay = fy * inv, az = fz * inv;
            ay -= gravity * grav[sp[i]];
            if (stir > 0.f) {  // tangential swirl around the beaker axis
                float r = std::sqrt(xi * xi + zi * zi);
                if (r > 0.05f) {
                    float k = stir * 9.f * std::min(r / R, 1.f) / r;
                    ax += -zi * k; az += xi * k;
                }
            }
            acc[3 * i] = ax; acc[3 * i + 1] = ay; acc[3 * i + 2] = az;
        }

        // 3) integrate + container collision
        const float pad = 0.5f * s, rest = 0.25f, vmax = 6.f;
        for (int i = 0; i < n; i++) {
            float* p = &pos[3 * i]; float* v = &vel[3 * i];
            for (int k = 0; k < 3; k++) v[k] += acc[3 * i + k] * dt;
            float sp2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
            if (sp2 > vmax * vmax) { float f = vmax / std::sqrt(sp2); v[0] *= f; v[1] *= f; v[2] *= f; }
            for (int k = 0; k < 3; k++) p[k] += v[k] * dt;
            float r = std::sqrt(p[0] * p[0] + p[2] * p[2]);
            if (r > R - pad) {
                float nx = p[0] / r, nz = p[2] / r;
                p[0] = nx * (R - pad); p[2] = nz * (R - pad);
                float vn = v[0] * nx + v[2] * nz;
                if (vn > 0) { v[0] -= (1 + rest) * vn * nx; v[2] -= (1 + rest) * vn * nz; }
            }
            if (p[1] < pad) { p[1] = pad; if (v[1] < 0) v[1] *= -rest; v[0] *= 0.98f; v[2] *= 0.98f; }
            if (p[1] > ymax) { p[1] = ymax; if (v[1] > 0) v[1] = 0; }
        }
        return events;
    }

    int add(int species, int count, float cx, float cy, float cz, float radius, float vy) {
        int added = 0;
        for (int layer = 0; added < count && n < cap; layer++) {
            float y = cy + layer * s;
            if (y > ymax - s) break;
            int m = (int)std::ceil(radius / s);
            for (int ix = -m; ix <= m && added < count && n < cap; ix++)
                for (int iz = -m; iz <= m && added < count && n < cap; iz++) {
                    float dx = ix * s, dz = iz * s;
                    if (dx * dx + dz * dz > radius * radius) continue;
                    float x = cx + dx + (rnd() - .5f) * 0.1f * s;
                    float z = cz + dz + (rnd() - .5f) * 0.1f * s;
                    if (x * x + z * z > (R - s) * (R - s)) continue;
                    pos[3 * n] = x; pos[3 * n + 1] = y + (rnd() - .5f) * 0.1f * s; pos[3 * n + 2] = z;
                    vel[3 * n] = vel[3 * n + 2] = 0; vel[3 * n + 1] = vy;
                    sp[n] = (uint8_t)std::clamp(species, 0, MAX_SPECIES - 1);
                    n++; added++;
                }
        }
        return added;
    }
};
}  // namespace

FLUID_API void* fluid_create(int mp, float r, float h) { return new Sim(mp, r, h); }
FLUID_API void  fluid_destroy(void* s) { delete static_cast<Sim*>(s); }
FLUID_API void  fluid_clear(void* s) { static_cast<Sim*>(s)->n = 0; }
FLUID_API int   fluid_count(void* s) { return static_cast<Sim*>(s)->n; }
FLUID_API int   fluid_add(void* s, int sp, int n, float cx, float cy, float cz, float r, float vy) {
    return static_cast<Sim*>(s)->add(sp, n, cx, cy, cz, r, vy);
}
FLUID_API void fluid_set_species(void* s, int id, float g, float v) {
    auto* m = static_cast<Sim*>(s);
    if (id >= 0 && id < MAX_SPECIES) { m->grav[id] = g; m->viscS[id] = v; }
}
FLUID_API void fluid_clear_reactions(void* s) {
    auto* m = static_cast<Sim*>(s);
    for (auto& row : m->rx) for (auto& r : row) r = Reaction{};
}
FLUID_API void fluid_add_reaction(void* s, int a, int b, int ra, int rb, float prob) {
    auto* m = static_cast<Sim*>(s);
    if (a < 0 || b < 0 || a >= MAX_SPECIES || b >= MAX_SPECIES) return;
    m->rx[a][b] = Reaction{ra, rb, prob, true};
    m->rx[b][a] = Reaction{rb, ra, prob, true};  // symmetric: (b,a) -> (rb,ra)
}
FLUID_API int fluid_step(void* s, float dt, float stir, float t) { return static_cast<Sim*>(s)->step(dt, stir, t); }
FLUID_API const float* fluid_positions(void* s) { return static_cast<Sim*>(s)->pos.data(); }
FLUID_API const unsigned char* fluid_species(void* s) { return static_cast<Sim*>(s)->sp.data(); }
FLUID_API float fluid_rest_density(void* s) { return static_cast<Sim*>(s)->rho0; }
FLUID_API float fluid_mean_density(void* s) { return static_cast<Sim*>(s)->lastMeanDensity; }
