import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "out/**", "test-data/**", "storage/**"] },
  ...tseslint.configs.recommended,
);
