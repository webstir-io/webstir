// sha256 (line endings normalized to LF) of every client-nav file Webstir has shipped into apps,
// from the feature sources, generated assets and template copies, so repair only removes unmodified copies.
export const SHIPPED_CLIENT_NAV_COPIES: Readonly<Record<string, ReadonlySet<string>>> = {
  'client-nav.ts': new Set([
    '32b8aba3c098876b42b4a7505da5925d114678e397c2c29f47381c47f787fdef',
    '7af2457c1e2121fc92874626693a615c1ef2adfb644cf9c038de224ddd853aba',
    '81a23a4db692191719d61be2210bce03f31bd10bf9148877afe7e04f3533e5ad',
    '954c49aa2772f4f0399071b54d1ae91597d0888bb8d94e11042c578af327aaaa',
    'a03945491e710731f403bdb2b72082b6c22c12a9d4e4cc76bdda247ebda11434',
    'c547b3d3a00043928ed9cd32c75c8b7bf6949bf8fb037cb8b5ee8aae98503216',
    'da7893583bab9df9dd6e29860f69d467c2affdc7a0f6af7206257d52f71acf86',
    'ed19d79dcc6c841b9ac089028f6138bdb26265d603840cb5a5d4617e6a17fd47',
    'f507de15cacbba891a4d198dbb36f47bc99b0ed43b7eb35f553738d2189b2b0c',
  ]),
  'document-navigation.ts': new Set([
    '862a593ba3d82d4a463c0757622279bdbf9dd7946baef0c2357d5fd77e5f13d2',
    '99a0017f65844bf5f04e02e3d7c9cb5835a952f076993de3a6d95473f8673971',
    'c7eb0507fc0129f47292c0d29144e46a6aa0a46bd9a903614fad81f0fd926202',
    'f3d69748eea26fb2815f1d9830847c6670e74e727f47b626e1f478ca4ad75ba4',
  ]),
  'form-enhancement.ts': new Set([
    '1bf83dbcac18f25ce65eab18e793c70fadb455797e16d96a2acc454a432bf333',
    '2772ac904e086982bd14d41d8852e7c46c05c2ab733d2f1f8a4f4769fbdfdb9d',
    '6167415b9e47d91b1d8093232491d308ab7bb14503014fba353d91e2f25f8eab',
    '6dbd11c99b415b5f4c532b7d3ce195d3c3c6d8b0e0cb6b0a965078a2842a1510',
    'a6b088d7bffc908365176bfb9653adc63850f2f4ad025e8c1e120f6453e87f76',
    'af81af854384f0d49e2669aa0c7b250eeb185a88234c8715657bbb18baeaa2d3',
  ]),
};
