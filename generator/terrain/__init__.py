"""Phase 2 terrain validator for Veydria cartography (spec: research/map-hardening/PHASE2-SPEC.md).

Modules:
- canon: loaders and ID resolvers shared by the validator and the bundle writers (spec A).
- validate: checks C1-C6, C8, C9, bundle preflight and sampling rules (spec B, C).
- canon_mask: writes a flat canon-mask bundle (spec D, canon self-check).
- bundle_from_prototype: wraps the prototype's elev.npy as a bundle (spec D).
"""

__all__ = ["canon", "validate", "canon_mask", "bundle_from_prototype"]
