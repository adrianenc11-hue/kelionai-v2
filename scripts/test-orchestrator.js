require('dotenv').config();
const { runOrchestration } = require('../server/orchestrator');

(async () => {
  console.log('⏳ Testăm Master Orchestration Core...');
  console.log(
    "Trimit cerere: 'Scrie o arhitectură Backend complexă folosind NestJS, Redis cache, și baza de date PostgreSQL, inclusiv teste.'\n"
  );

  try {
    const result = await runOrchestration(
      'Scrie o arhitectură Backend complexă folosind NestJS, Redis cache, și baza de date PostgreSQL, inclusiv teste.',
      null, // mock brain
      [], // mock history
      { id: 'test_user', email: 'test@kelion.com', plan: 'premium' }, // user
      {}, // options
      (step, detail) => {
        // Afișăm logurile de progres în timp real
        console.log(`[PROGRES] ${step}: ${detail}`);
      }
    );

    console.log('\n✅ RĂSPUNS FINAL ORCHESTRATOR SCHEMA:\n');
    // Extragem doar schema cerută
    const contract = {
      job_id: result.job_id,
      task_category: result.task_category,
      complexity: result.complexity,
      risk: result.risk,
      budget_mode: result.budget_mode,
      priority: result.priority,
      selected_agents: result.selected_agents,
      plan: result.plan,
      acceptance_criteria: result.acceptance_criteria,
      validation_results: result.validation_results,
      final_status: result.final_status,
      final_judge: result.final_judge,
    };

    console.log(JSON.stringify(contract, null, 2));
  } catch (e) {
    console.error('Eroare:', e);
  }
})();
