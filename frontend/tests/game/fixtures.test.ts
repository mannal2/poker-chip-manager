import { runFixtureSuite, validateFixtureSchema } from './fixtureRunner';

runFixtureSuite('settings');
runFixtureSuite('lifecycle');
runFixtureSuite('undo');
validateFixtureSchema('forfeit');
