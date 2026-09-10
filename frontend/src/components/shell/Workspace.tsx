import { useEffect } from "react";
import { Ribbon } from "./Ribbon";
import { ContainerStrip } from "./ContainerStrip";
import { TimeBar } from "./TimeBar";
import { SignalPage } from "./SignalPage";
import { PipelinePage } from "./PipelinePage";
import { ICA } from "../panels/ICA";
import { ICACard } from "../cards/ICACard";
import { SourceCard } from "../cards/SourceCard";
import { ChannelsPage } from "./ChannelsPage";
import { EpochsCard } from "../cards/EpochsCard";
import { EvokedCard } from "../cards/EvokedCard";
import { TFRCard } from "../cards/TFRCard";
import { SelectionBar } from "./SelectionBar";
import { useStore } from "../../store/store";
import type { Page } from "../../lib/router";

/**
 * The v6 shell: two tab axes and one viewport between them.
 *
 *   ribbon (top)     verbs: what to do to the thing you're looking at
 *   viewport         the thing you're looking at
 *   time bar         the recording's clock: shared by every container
 *   container strip  nouns: which MNE container that is
 *
 * This replaces the v3 three-page split, whose middle page ("Analysis") was
 * defined by negation: everything that wasn't Raw, and so had no shape to
 * grow into. Containers have a shape: the strip is generated from the server's
 * container graph, so the navigation is the data model rather than a hand-kept
 * list of screens.
 */
/** Containers whose x axis is the recording's clock. */
const RECORDING_TIME = new Set<Page>(["signal", "channels", "ica", "source"]);

export function Workspace({ page, onNewSession }: { page: Page; onNewSession: () => void }) {
  const setMaximized = useStore((s) => s.setMaximized);
  const setActiveContainer = useStore((s) => s.setActiveContainer);

  // a maximized pane never survives a container switch, it'd be maximized nowhere
  useEffect(() => { setMaximized(null); }, [page, setMaximized]);
  // the route is the container: keep the store's idea of "active" in step, so
  // the palette filters its operations to the thing actually on screen
  useEffect(() => {
    setActiveContainer(page === "signal" ? "raw" : page === "pipeline" ? "raw" : page);
  }, [page, setActiveContainer]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg">
      <Ribbon onNewSession={onNewSession} />
      <div className="relative min-h-0 flex-1">
        <Viewport page={page} />
        <SelectionBar />
      </div>
      {/* the clock belongs to the recording, so it follows every container that
          shares its time base. Evoked and TFR are epoch-relative and Pipeline has
          no time axis at all, so a transport on those three would be a lie. */}
      {RECORDING_TIME.has(page) && <TimeBar page={page} />}
      <ContainerStrip page={page} />
    </div>
  );
}

function Viewport({ page }: { page: Page }) {
  const hasIca = useStore((s) => s.hasIca);
  switch (page) {
    case "signal":
      return <SignalPage />;
    case "channels":
      return <ChannelsPage />;
    case "ica":
      return hasIca ? <ICA /> : <ICACard />;
    case "epochs":
      return <EpochsCard />;
    case "evoked":
      return <EvokedCard />;
    case "tfr":
      return <TFRCard />;
    case "source":
      return <SourceCard />;
    case "pipeline":
      return <PipelinePage />;
  }
}
