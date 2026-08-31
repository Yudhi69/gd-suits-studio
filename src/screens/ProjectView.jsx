import React, { useEffect, useMemo, useRef, useState } from 'react';
import { STEPS, isVisible } from '../lib/catalog.js';
import { useProject } from '../lib/useProject.js';
import PriceBar from '../components/PriceBar.jsx';
import { Spinner, Banner } from '../components/ui.jsx';

import ClientStep from './project/ClientStep.jsx';
import CaptureStep from './project/CaptureStep.jsx';
import FabricStep from './project/FabricStep.jsx';
import BuilderStep from './project/BuilderStep.jsx';
import MeasureStep from './project/MeasureStep.jsx';
import PreviewStep from './project/PreviewStep.jsx';
import FittingStep from './project/FittingStep.jsx';
import SummaryStep from './project/SummaryStep.jsx';

/**
 * The consultation flow.
 *
 * Deliberately a progressive sequence rather than one long form - the brief
 * asks for it to feel like a game, one decision at a time, with the running
 * price always in view.
 */
export default function ProjectView({ projectId, onBack, overrides, hasKey }) {
  const ctx = useProject(projectId);
  const [stepKey, setStepKey] = useState('client');
  const stepperRef = useRef(null);
  const { project, loading, error } = ctx;

  // The stepper scrolls horizontally once there are enough steps; keep the
  // current one on screen so the tailor can always see where they are.
  useEffect(() => {
    stepperRef.current
      ?.querySelector('.step-tab.active')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [stepKey]);

  const steps = useMemo(() => {
    if (!project) return [];
    const spec = project.spec ?? {};
    return [
      { key: 'client', title: 'Client', done: !!project.name },
      { key: 'capture', title: 'Capture', done: project.photos.some((p) => ['front', 'side', 'back', 'face'].includes(p.slot)) },
      { key: 'fabric', title: 'Cloth', done: project.photos.some((p) => p.slot === 'fabric') || !!project.analysis?.fabricColour },
      ...STEPS.filter((s) => isVisible(s, spec)).map((s) => ({
        key: s.key,
        title: s.title,
        catalog: s,
        done: s.fields.filter((f) => f.required && isVisible(f, spec)).every((f) => spec[f.id] !== undefined),
      })),
      { key: 'measurements', title: 'Measurements', done: project.measurements.some((m) => m.value !== null) },
      { key: 'preview', title: 'Preview', done: project.renders.length > 0 },
      { key: 'fitting', title: 'Fitting', done: project.fittings.length > 0 },
      { key: 'summary', title: 'Summary', done: project.renders.some((r) => r.approved) },
    ];
  }, [project]);

  if (loading) {
    return <div className="content center" style={{ paddingTop: 80 }}><Spinner /></div>;
  }
  if (error) {
    return (
      <div className="content">
        <Banner kind="danger">{error.message}</Banner>
        <button className="btn" style={{ marginTop: 14 }} onClick={onBack}>Back to orders</button>
      </div>
    );
  }

  const current = steps.find((s) => s.key === stepKey) ?? steps[0];
  const index = steps.indexOf(current);

  function body() {
    if (current.catalog) return <BuilderStep ctx={ctx} step={current.catalog} overrides={overrides} />;
    switch (current.key) {
      case 'client': return <ClientStep ctx={ctx} />;
      case 'capture': return <CaptureStep ctx={ctx} />;
      case 'fabric': return <FabricStep ctx={ctx} />;
      case 'measurements': return <MeasureStep ctx={ctx} />;
      case 'preview': return <PreviewStep ctx={ctx} hasKey={hasKey} />;
      case 'fitting': return <FittingStep ctx={ctx} />;
      case 'summary': return <SummaryStep ctx={ctx} overrides={overrides} />;
      default: return null;
    }
  }

  return (
    <>
      <div className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>&larr; Orders</button>
        <div>
          <h2>{project.name} {project.surname}</h2>
          <div className="tiny faint">{project.title}</div>
        </div>
        <div className="spacer" />
        <span className={`pill ${project.status === 'draft' ? 'pill-quiet' : 'pill-ok'}`}>{project.status}</span>
      </div>

      <div className="content wide">
        <div className="stepper" ref={stepperRef} style={{ marginBottom: 20 }}>
          {steps.map((s, i) => (
            <button
              key={s.key}
              className={`step-tab ${s.key === current.key ? 'active' : ''} ${s.done ? 'done' : ''}`}
              onClick={() => setStepKey(s.key)}
            >
              <span className="num">{s.done && s.key !== current.key ? '✓' : i + 1}</span>
              {s.title}
            </button>
          ))}
        </div>

        {body()}

        <div style={{ marginTop: 22 }}>
          <PriceBar
            spec={project.spec}
            overrides={overrides}
            right={
              <>
                <button
                  className="btn btn-sm"
                  style={{ background: 'transparent', borderColor: 'var(--ink-line)', color: 'var(--on-dark)' }}
                  disabled={index <= 0}
                  onClick={() => setStepKey(steps[index - 1].key)}
                >
                  Back
                </button>
                <button
                  className="btn btn-sm btn-gold"
                  disabled={index >= steps.length - 1}
                  onClick={() => setStepKey(steps[index + 1].key)}
                >
                  Next: {steps[index + 1]?.title ?? ''}
                </button>
              </>
            }
          />
        </div>
      </div>
    </>
  );
}
