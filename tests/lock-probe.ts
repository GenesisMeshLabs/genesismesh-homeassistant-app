import { Journal } from '../src/journal.js';

try {
  const journal = new Journal(process.argv[2]!);
  journal.close();
  process.stderr.write('A second process unexpectedly acquired the writer.\n');
  process.exitCode = 1;
} catch {
  process.stdout.write('writer-refused\n');
}
