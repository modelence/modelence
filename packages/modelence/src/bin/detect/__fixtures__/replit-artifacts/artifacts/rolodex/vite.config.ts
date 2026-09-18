export default {
  base: process.env.BASE_PATH,
  build: { outDir: path.resolve(import.meta.dirname, 'dist/public') },
};
