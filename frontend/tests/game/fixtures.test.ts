import { runFixtureSuite, validateFixtureSchema } from './fixtureRunner';

runFixtureSuite('settings');
runFixtureSuite('lifecycle');
runFixtureSuite('undo');
runFixtureSuite('events');
validateFixtureSchema('forfeit');
