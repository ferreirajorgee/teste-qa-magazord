/**
 * Arquivo de suporte global, carregado antes de cada spec.
 * Concentra apenas o que vale para todas as partes: plugins e commands.
 * Hooks específicos de uma questão ficam no próprio spec.
 */
import 'cypress-mochawesome-reporter/register';
import { register as registerCypressGrep } from '@cypress/grep';

import './commands';

// Habilita filtro por tags: it('...', { tags: '@smoke' }, () => {})
registerCypressGrep();
