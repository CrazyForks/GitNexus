/**
 * Phase 8: Field/property type resolution — verifies that chained member access
 * through typed fields resolves correctly (e.g. user.address.save() → Address#save).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

describe('Field type resolution (TypeScript)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'field-types'),
      () => {},
    );
  }, 60000);

  it('detects classes: Address, Config, User', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['Address', 'Config', 'User']);
  });

  it('detects Property nodes for typed fields', () => {
    const properties = getNodesByLabel(result, 'Property');
    // Should capture: address, city, name (from User + Address classes)
    // DEFAULT is static and may or may not be captured depending on tree-sitter query
    expect(properties).toContain('address');
    expect(properties).toContain('name');
    expect(properties).toContain('city');
  });

  it('emits HAS_METHOD edges linking properties to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    // At minimum: User.address, User.name, Address.city
    expect(propEdges.length).toBeGreaterThanOrEqual(3);
    expect(edgeSet(propEdges)).toContain('User → address');
    expect(edgeSet(propEdges)).toContain('User → name');
    expect(edgeSet(propEdges)).toContain('Address → city');
  });

  it('resolves user.address.save() → Address#save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    // processUser should call save() with receiver type Address
    const saveCalls = calls.filter(e => e.target === 'save');
    // The save method belongs to Address, so the target should be Address's save
    const addressSave = saveCalls.find(e => e.targetFilePath.includes('models'));
    expect(addressSave).toBeDefined();
    expect(addressSave!.source).toBe('processUser');
  });
});
