// ChemLab fluid core - C API (loaded from Python via ctypes)
#pragma once
#ifdef _WIN32
#define FLUID_API extern "C" __declspec(dllexport)
#else
#define FLUID_API extern "C" __attribute__((visibility("default")))
#endif

FLUID_API void*  fluid_create(int max_particles, float container_radius, float container_height);
FLUID_API void   fluid_destroy(void* sim);
FLUID_API void   fluid_clear(void* sim);
FLUID_API int    fluid_count(void* sim);
// Spawn up to n particles of `species` on a lattice disc (radius) starting at (cx,cy,cz), stacking upward.
FLUID_API int    fluid_add(void* sim, int species, int n, float cx, float cy, float cz, float radius, float vy);
FLUID_API void   fluid_set_species(void* sim, int id, float gravity_scale, float viscosity_scale);
FLUID_API void   fluid_clear_reactions(void* sim);
// When particles of species a and b touch, they become ra and rb with probability `prob` per step.
FLUID_API void   fluid_add_reaction(void* sim, int a, int b, int ra, int rb, float prob);
// Advance by dt. stir in [0,1]. temperature in Celsius. Returns number of reaction events.
FLUID_API int    fluid_step(void* sim, float dt, float stir, float temperature);
FLUID_API const float*         fluid_positions(void* sim);  // xyz interleaved
FLUID_API const unsigned char* fluid_species(void* sim);
FLUID_API float  fluid_rest_density(void* sim);
FLUID_API float  fluid_mean_density(void* sim);
