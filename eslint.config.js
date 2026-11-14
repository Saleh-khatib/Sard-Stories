import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", ".next/**", "out/**", "test-data/**", "storage/**", "next-env.d.ts"] },
  ...tseslint.configs.recommended,
);
