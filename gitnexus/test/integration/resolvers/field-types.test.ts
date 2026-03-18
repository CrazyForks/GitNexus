/**
 * Phase 8: Field/property type resolution — verifies that chained member access
 * through typed fields resolves correctly (e.g. user.address.save() → Address#save).
 *
 * Per-language fixtures test:
 * 1. Property nodes are extracted with correct ownerId linkage
 * 2. HAS_METHOD edges link properties to their owning classes
 * 3. Field-access chain resolution resolves user.address.save() → Address#save
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

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
    expect(properties).toContain('address');
    expect(properties).toContain('name');
    expect(properties).toContain('city');
  });

  it('emits HAS_METHOD edges linking properties to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    expect(propEdges.length).toBeGreaterThanOrEqual(3);
    expect(edgeSet(propEdges)).toContain('User → address');
    expect(edgeSet(propEdges)).toContain('User → name');
    expect(edgeSet(propEdges)).toContain('Address → city');
  });

  it('resolves user.address.save() → Address#save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCalls = calls.filter(e => e.target === 'save');
    const addressSave = saveCalls.find(e => e.targetFilePath.includes('models'));
    expect(addressSave).toBeDefined();
    expect(addressSave!.source).toBe('processUser');
  });
});

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

describe('Field type resolution (Java)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'java-field-types'),
      () => {},
    );
  }, 60000);

  it('detects classes: Address, App, User', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['Address', 'App', 'User']);
  });

  it('detects Property nodes for Java fields', () => {
    const properties = getNodesByLabel(result, 'Property');
    expect(properties).toContain('address');
    expect(properties).toContain('name');
    expect(properties).toContain('city');
  });

  it('emits HAS_METHOD edges linking properties to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    expect(propEdges.length).toBeGreaterThanOrEqual(3);
    expect(edgeSet(propEdges)).toContain('User → address');
    expect(edgeSet(propEdges)).toContain('User → name');
    expect(edgeSet(propEdges)).toContain('Address → city');
  });

  it('resolves user.address.save() → Address#save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCalls = calls.filter(e => e.target === 'save');
    const addressSave = saveCalls.find(
      e => e.source === 'processUser' && e.targetFilePath.includes('Address'),
    );
    expect(addressSave).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

describe('Field type resolution (C#)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'csharp-field-types'),
      () => {},
    );
  }, 60000);

  it('detects classes: Address, Service, User', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['Address', 'Service', 'User']);
  });

  it('detects Property nodes for C# properties', () => {
    const properties = getNodesByLabel(result, 'Property');
    // C# property_declaration already captured before Phase 8
    expect(properties).toContain('Address');
    expect(properties).toContain('Name');
    expect(properties).toContain('City');
  });

  it('emits HAS_METHOD edges linking properties to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    expect(propEdges.length).toBeGreaterThanOrEqual(3);
    expect(edgeSet(propEdges)).toContain('User → Address');
    expect(edgeSet(propEdges)).toContain('User → Name');
    expect(edgeSet(propEdges)).toContain('Address → City');
  });

  it('resolves user.Address.Save() → Address#Save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCalls = calls.filter(e => e.target === 'Save');
    const addressSave = saveCalls.find(
      e => e.source === 'ProcessUser' && e.targetFilePath.includes('Models'),
    );
    expect(addressSave).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe('Field type resolution (Go)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'go-field-types'),
      () => {},
    );
  }, 60000);

  it('detects structs: Address, User', () => {
    expect(getNodesByLabel(result, 'Struct')).toEqual(['Address', 'User']);
  });

  it('detects Property nodes for Go struct fields', () => {
    const properties = getNodesByLabel(result, 'Property');
    expect(properties).toContain('Address');
    expect(properties).toContain('Name');
    expect(properties).toContain('City');
  });

  it('emits HAS_METHOD edges linking struct fields to structs', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    expect(propEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves user.Address.Save() → Address#Save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCalls = calls.filter(e => e.target === 'Save');
    const addressSave = saveCalls.find(
      e => e.source === 'processUser' && e.targetFilePath.includes('models'),
    );
    expect(addressSave).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

describe('Field type resolution (Kotlin)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'kotlin-field-types'),
      () => {},
    );
  }, 60000);

  it('detects classes: Address, User', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['Address', 'User']);
  });

  it('detects Property nodes for Kotlin properties', () => {
    const properties = getNodesByLabel(result, 'Property');
    // Kotlin property_declaration was already captured pre-Phase 8
    expect(properties).toContain('address');
    expect(properties).toContain('name');
    expect(properties).toContain('city');
  });

  it('emits HAS_METHOD edges linking properties to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    expect(propEdges.length).toBeGreaterThanOrEqual(3);
    expect(edgeSet(propEdges)).toContain('User → address');
    expect(edgeSet(propEdges)).toContain('User → name');
    expect(edgeSet(propEdges)).toContain('Address → city');
  });

  it('resolves user.address.save() → Address#save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCalls = calls.filter(e => e.target === 'save');
    const addressSave = saveCalls.find(
      e => e.source === 'processUser' && e.targetFilePath.includes('Models'),
    );
    expect(addressSave).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

describe('Field type resolution (PHP)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'php-field-types'),
      () => {},
    );
  }, 60000);

  it('detects classes: Address, Service, User', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['Address', 'Service', 'User']);
  });

  it('detects Property nodes for PHP properties', () => {
    const properties = getNodesByLabel(result, 'Property');
    // PHP property_declaration was already captured pre-Phase 8
    expect(properties).toContain('address');
    expect(properties).toContain('name');
    expect(properties).toContain('city');
  });

  it('emits HAS_METHOD edges linking properties to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const propEdges = hasMethod.filter(e => e.targetLabel === 'Property');
    expect(propEdges.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves $user->address->save() → Address#save via field type', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCalls = calls.filter(e => e.target === 'save');
    const addressSave = saveCalls.find(
      e => e.source === 'processUser' && e.targetFilePath.includes('Models'),
    );
    expect(addressSave).toBeDefined();
  });
});
