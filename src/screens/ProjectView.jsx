import React, { useEffect, useMemo, useState } from 'react';
import { isVisible, statusLabel, statusPill, isOpenStatus } from '../lib/catalog.js';
import { completeOrder } from '../lib/complete.js';
import { useProject } from '../lib/useProject.js';
import SuitStrip from '../components/SuitStrip.jsx';
import { agreedQuote, isDraft, lacksPrice } from '../lib/quote.js';
import { api, messageFor } from '../lib/api.js';
import PriceBar from '../components/PriceBar.jsx';
import Stepper from '../components/Stepper.jsx';
import { Spinner, Banner, ConfirmButton, useToast } from '../components/ui.jsx';

import ClientStep from './project/ClientStep.jsx';
import OrderStep from './project/OrderStep.jsx';
import PhotosStep from './project/PhotosStep.jsx';
import BuilderStep from './project/BuilderStep.jsx';
import MeasureStep from './project/MeasureStep.jsx';
import PreviewStep from './project/PreviewStep.jsx';
import FittingStep from './project/FittingStep.jsx';
import SummaryStep from './project/SummaryStep.jsx';
import { InformalQuoteModal } from '../components/InformalQuote.jsx';

/**
 * The consultation flow.
 *
 * Deliberately a progressive sequence rather than one long form - the brief
 * asks for it to feel like a game, one decision at a time, with the running
 * price always in view.
 */
export default function ProjectView({ projectId, onBack, overrides, business, hasKey, steps: catalogSteps, unit, onUnitChange, customOptions, onCatalogChanged, onOverridesChanged }) {
  const ctx = useProject(projectId);
  const [stepKey, setStepKey] = useState('client');
  const [informalOpen, setInformalOpen] = useState(false);
  const toast = useToast();
  const { project, loading, error } = ctx;

  const steps = useMemo(() => {
    if (!project) return [];
    const spec = ctx.spec ?? project.spec ?? {};
    return [
      { key: 'client', title: 'Client', done: !!project.name },
      { key: 'order', title: 'Order', done: !!(project.fabric_name || project.payments?.length) },
      // The garment is specified straight after the order it belongs to, which
      // is the order GD works in: agree the job, then build the suit. The
      // photographs and the cloth follow, because they serve the render.
      ...catalogSteps.filter((s) => isVisible(s, spec)).map((s) => ({
        key: s.key,
        title: s.title,
        catalog: s,
        done: s.fields.filter((f) => f.required && isVisible(f, spec)).every((f) => spec[f.id] !== undefined),
      })),
      // Measured once the suit is designed and before anything is rendered,
      // where GD takes them: the tape comes out before the camera.
      { key: 'measurements', title: 'Measurements', done: project.measurements.some((m) => m.value !== null) },
      // The photographs and the cloth are one page: both are the camera coming
      // out, in the same few minutes, to feed the render.
      {
        key: 'capture',
        title: 'Photos & Cloth',
        done: project.photos.some((p) => ['front', 'side', 'back', 'face', 'fabric'].includes(p.slot)) || !!project.analysis?.fabricColour,
      },
      { key: 'preview', title: 'Preview', done: project.renders.length > 0 },
      { key: 'fitting', title: 'Fitting', done: project.fittings.length > 0 },
      { key: 'summary', title: 'Summary', done: project.renders.some((r) => r.approved) },
    ];
  }, [project, catalogSteps, ctx.spec]);

  // Any status past draft means a figure has been shown to a client, so the
  // quote is frozen at that point, whichever screen moved the status - the
  // fitting step sets it too. Declared before the early returns below: a hook
  // that only runs on some renders breaks React's hook ordering.
  useEffect(() => {
    if (!project || project.quote || isDraft(project.status)) return;
    // The whole order, every suit on it - not whichever suit happened to be
    // on screen when the status moved - at the figures the client was last
    // quoted, if the order is unchanged since.
    const quote = agreedQuote(project, overrides, catalogSteps, project.status);
    // A suit with no price yet is not fixed at R0. It is fixed once it has
    // one: the next time the order is opened, or its status moves.
    if (lacksPrice(quote)) return;
    api.projects
      .setQuote({ id: project.id, quote })
      .then(() => ctx.reload())
      .catch(() => {});
  }, [project?.status, project?.quote]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Off the current list and onto the completed one; the status says
  // whether the balance is still to come in.
  async function complete() {
    try {
      const status = await completeOrder(project.id, overrides, catalogSteps);
      await ctx.reload();
      toast(`Moved to completed - ${statusLabel(status).toLowerCase()}`, 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    }
  }

  const current = steps.find((s) => s.key === stepKey) ?? steps[0];
  const index = steps.indexOf(current);

  function body() {
    if (current.catalog) {
      return (
        <BuilderStep
          ctx={ctx}
          step={current.catalog}
          steps={catalogSteps}
          overrides={overrides}
          onCatalogChanged={onCatalogChanged}
          onOverridesChanged={onOverridesChanged}
        />
      );
    }
    switch (current.key) {
      case 'client': return <ClientStep ctx={ctx} customOptions={customOptions} onCatalogChanged={onCatalogChanged} />;
      case 'order':
        return (
          <OrderStep ctx={ctx} business={business} />
        );
      case 'capture': return <PhotosStep ctx={ctx} />;
      case 'measurements': return <MeasureStep ctx={ctx} unit={unit} onUnitChange={onUnitChange} business={business} />;
      case 'preview': return <PreviewStep ctx={ctx} hasKey={hasKey} steps={catalogSteps} />;
      case 'fitting': return <FittingStep ctx={ctx} unit={unit} />;
      case 'summary':
        return (
          <SummaryStep
            ctx={ctx}
            overrides={overrides}
            steps={catalogSteps}
            unit={unit}
            business={business}
            customOptions={customOptions}
            onInformal={() => setInformalOpen(true)}
          />
        );
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
        {isOpenStatus(project.status) && (
          <ConfirmButton className="btn btn-sm" confirmLabel="Mark completed?" onConfirm={complete}>
            Completed
          </ConfirmButton>
        )}
        <span className={`pill ${statusPill(project.status)}`}>{statusLabel(project.status)}</span>
      </div>

      <div className="content wide">
        <div style={{ marginBottom: 20 }}>
          <Stepper scrollKey={current.key}>
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
          </Stepper>
        </div>

        {/* The garment pages, the measurements and the preview are all about
            one suit; the client, order, fitting and summary pages are about
            the order as a whole, so the strip stays off them. */}
        {!['client', 'order', 'fitting', 'summary'].includes(current.key) && (
          <SuitStrip suits={ctx.suits} activeSuitId={ctx.activeSuitId} onSelect={ctx.setActiveSuitId} />
        )}

        {body()}

        {informalOpen && (
          <InformalQuoteModal
            project={project}
            overrides={overrides}
            steps={catalogSteps}
            business={business}
            customOptions={customOptions}
            onClose={() => setInformalOpen(false)}
            onSent={() => ctx.reload()}
          />
        )}

        <div style={{ marginTop: 22 }}>
          <PriceBar
            order={project}
            activeSuitId={ctx.activeSuitId}
            overrides={overrides}
            steps={catalogSteps}
            quote={project.quote}
            right={
              <>
                {/* From the base garment on, there is enough to send. */}
                <button
                  className="btn btn-sm"
                  style={{ background: 'transparent', borderColor: 'var(--gold)', color: 'var(--gold)' }}
                  onClick={() => setInformalOpen(true)}
                >
                  Informal quote
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'transparent', borderColor: 'var(--sidebar-line)', color: 'var(--sidebar-text)' }}
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
