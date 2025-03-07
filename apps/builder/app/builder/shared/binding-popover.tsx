import {
  type ButtonHTMLAttributes,
  type RefObject,
  forwardRef,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { isFeatureEnabled } from "@webstudio-is/feature-flags";
import {
  DotIcon,
  InfoCircleIcon,
  PlusIcon,
  ResetIcon,
  TrashIcon,
} from "@webstudio-is/icons";
import {
  Box,
  Button,
  CssValueListArrowFocus,
  CssValueListItem,
  Flex,
  FloatingPanelPopover,
  FloatingPanelPopoverClose,
  FloatingPanelPopoverContent,
  FloatingPanelPopoverTitle,
  FloatingPanelPopoverTrigger,
  InputErrorsTooltip,
  Label,
  ScrollArea,
  SmallIconButton,
  Text,
  Tooltip,
  theme,
} from "@webstudio-is/design-system";
import {
  decodeDataSourceVariable,
  validateExpression,
} from "@webstudio-is/react-sdk";
import { ExpressionEditor, formatValuePreview } from "./expression-editor";
import { useSideOffset } from "./floating-panel";
import { $dataSourceVariables } from "~/shared/nano-states";

export const evaluateExpressionWithinScope = (
  expression: string,
  scope: Record<string, unknown>
) => {
  let expressionWithScope = "";
  for (const [name, value] of Object.entries(scope)) {
    expressionWithScope += `const ${name} = ${JSON.stringify(value)};\n`;
  }
  expressionWithScope += `return (${expression})`;
  try {
    const fn = new Function(expressionWithScope);
    return fn();
  } catch {
    //
  }
};

/**
 * execute valid expression without scope
 * to check any variable usage
 */
export const isLiteralExpression = (expression: string) => {
  try {
    const fn = new Function(`return (${expression})`);
    fn();
    return true;
  } catch {
    return false;
  }
};

const getUsedIdentifiers = (expression: string) => {
  const identifiers = new Set<string>();
  // prevent parsing empty expression
  if (expression === "") {
    return identifiers;
  }
  // avoid parsing error
  try {
    validateExpression(expression, {
      transformIdentifier: (identifier) => {
        identifiers.add(identifier);
        return identifier;
      },
    });
  } catch {
    //
  }
  return identifiers;
};

const BindingPanel = ({
  scope,
  aliases,
  valueError,
  value,
  onChange,
  onSave,
}: {
  scope: Record<string, unknown>;
  aliases: Map<string, string>;
  valueError?: string;
  value: string;
  onChange: () => void;
  onSave: (value: string, invalid: boolean) => void;
}) => {
  const [expression, setExpression] = useState(value);
  const usedIdentifiers = useMemo(() => getUsedIdentifiers(value), [value]);
  const [error, setError] = useState<undefined | string>();
  const [touched, setTouched] = useState(false);

  const updateExpression = (newExpression: string) => {
    setExpression(newExpression);
    onChange();
    try {
      if (newExpression.trim().length === 0) {
        throw Error("Cannot use empty expression");
      }
      // update value only when expression is valid
      validateExpression(newExpression, {
        transformIdentifier: (identifier) => {
          if (aliases.has(identifier) === false) {
            throw Error(`Unknown variable "${identifier}"`);
          }
          return identifier;
        },
      });
      setError(undefined);
    } catch (error) {
      setError((error as Error).message);
    }
  };

  return (
    <ScrollArea
      css={{
        display: "flex",
        flexDirection: "column",
        width: theme.spacing[30],
      }}
    >
      <Box css={{ paddingBottom: theme.spacing[5] }}>
        <Flex gap="1" css={{ px: theme.spacing[9], py: theme.spacing[5] }}>
          <Text variant="labelsSentenceCase">Variables</Text>
          <Tooltip
            variant="wrapped"
            content={
              "Click on the available variables in this scope to insert them into the Expression Editor."
            }
          >
            <InfoCircleIcon tabIndex={0} />
          </Tooltip>
        </Flex>

        <CssValueListArrowFocus>
          {Object.entries(scope).map(([identifier, value], index) => {
            const name = aliases.get(identifier);
            const label =
              value === undefined
                ? name
                : `${name}: ${formatValuePreview(value)}`;
            return (
              <CssValueListItem
                key={identifier}
                id={identifier}
                index={index}
                label={<Label truncate>{label}</Label>}
                // mark all variables used in expression as selected
                active={usedIdentifiers.has(identifier)}
                // convert variable to expression
                onClick={() => {
                  updateExpression(identifier);
                  onSave(identifier, false);
                }}
              />
            );
          })}
        </CssValueListArrowFocus>
      </Box>
      <Flex gap="1" css={{ px: theme.spacing[9], py: theme.spacing[5] }}>
        <Text variant="labelsSentenceCase">Expression Editor</Text>
        <Tooltip
          variant="wrapped"
          content={
            <Text>
              Compose variables, do math; the result of the expression will be
              used as a value.
              <br />
              Example: VariableA || VariableB || &quot;DefaultValue&quot;
              <br />
              Explanation: If VariableA is empty, use VariableB; otherwise use
              &quot;DefaultValue&quot;.
            </Text>
          }
        >
          <InfoCircleIcon tabIndex={0} />
        </Tooltip>
      </Flex>
      <Box css={{ padding: `0 ${theme.spacing[9]} ${theme.spacing[9]}` }}>
        <InputErrorsTooltip
          errors={
            touched && error ? [error] : valueError ? [valueError] : undefined
          }
        >
          <div>
            <ExpressionEditor
              scope={scope}
              aliases={aliases}
              color={
                error !== undefined || valueError !== undefined
                  ? "error"
                  : undefined
              }
              autoFocus={true}
              value={expression}
              onChange={(value) => {
                updateExpression(value);
                setTouched(false);
              }}
              onBlur={() => {
                onSave(expression, error !== undefined);
                setTouched(true);
              }}
            />
          </div>
        </InputErrorsTooltip>
      </Box>
    </ScrollArea>
  );
};

const bindingOpacityProperty = "--ws-binding-opacity";

export const BindingControl = ({ children }: { children: ReactNode }) => {
  return (
    <Box
      css={{
        position: "relative",
        "&:hover": { [bindingOpacityProperty]: 1 },
      }}
    >
      {children}
    </Box>
  );
};

export type BindingVariant = "default" | "bound" | "overwritten";

const BindingButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant: BindingVariant;
    error?: string;
    value: string;
  }
>(({ variant, error, value, ...props }, ref) => {
  const expanded = props["aria-expanded"];
  const overwrittenMessage =
    variant === "overwritten" ? (
      <Flex direction="column" gap="2" css={{ maxWidth: theme.spacing[28] }}>
        <Text>Bound variable is overwritten with temporary value</Text>
        <Button
          color="dark"
          prefix={<ResetIcon />}
          css={{ flexGrow: 1 }}
          onClick={() => {
            const potentialVariableId = decodeDataSourceVariable(value);
            const dataSourceVariables = new Map($dataSourceVariables.get());
            if (potentialVariableId !== undefined) {
              dataSourceVariables.delete(potentialVariableId);
              $dataSourceVariables.set(dataSourceVariables);
            }
          }}
        >
          Reset value
        </Button>
      </Flex>
    ) : undefined;
  const tooltipContent = error ?? overwrittenMessage;
  return (
    // prevent giving content to tooltip when popover is open
    // to avoid button remounting and popover flickering
    // when switch between valid and error value
    <Tooltip content={expanded ? undefined : tooltipContent} delayDuration={0}>
      <SmallIconButton
        ref={ref}
        data-variant={variant}
        css={{
          // hide by default
          opacity: `var(${bindingOpacityProperty}, 0)`,
          position: "absolute",
          top: 0,
          left: 0,
          boxSizing: "border-box",
          padding: 2,
          transform: "translate(-50%, -50%) scale(1)",
          transition: "transform 60ms, opacity 0ms 60ms",
          // https://easings.net/#easeInOutSine
          transitionTimingFunction: "cubic-bezier(0.37, 0, 0.63, 1)",
          "--dot-display": "block",
          "--plus-display": "none",
          "&[data-variant=bound], &[data-variant=overwritten]": {
            opacity: 1,
          },
          "&:hover, &:focus-visible, &[aria-expanded=true]": {
            // always show when interacted with
            opacity: 1,
            transform: `translate(-50%, -50%) scale(1.5)`,
            "--dot-display": "none",
            "--plus-display": "block",
          },
        }}
        {...props}
        icon={
          <Box
            css={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: theme.colors.backgroundStyleSourceToken,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              "&[data-variant=bound]": {
                backgroundColor: theme.colors.backgroundStyleSourceLocal,
              },
              "&[data-variant=overwritten]": {
                backgroundColor: theme.colors.borderOverwrittenMain,
              },
              "&[data-variant=error]": {
                backgroundColor: theme.colors.backgroundDestructiveMain,
              },
            }}
            data-variant={error ? "error" : variant}
          >
            <DotIcon
              size={14}
              fill="white"
              style={{ display: `var(--dot-display)` }}
            />
            <PlusIcon
              size={10}
              fill="white"
              style={{ display: `var(--plus-display)` }}
            />
          </Box>
        }
      />
    </Tooltip>
  );
});
BindingButton.displayName = "BindingButton";

const BindingPopoverContext = createContext<{
  containerRef?: RefObject<HTMLElement>;
}>({});

export const BindingPopoverProvider = BindingPopoverContext.Provider;

export const BindingPopover = ({
  scope,
  aliases,
  variant,
  validate,
  value,
  onChange,
  onRemove,
}: {
  scope: Record<string, unknown>;
  aliases: Map<string, string>;
  variant: BindingVariant;
  validate?: (value: unknown) => undefined | string;
  value: string;
  onChange: (newValue: string) => void;
  onRemove: (evaluatedValue: unknown) => void;
}) => {
  const { containerRef } = useContext(BindingPopoverContext);
  const [isOpen, onOpenChange] = useState(false);
  const [triggerRef, sideOffset] = useSideOffset({ isOpen, containerRef });
  const hasUnsavedChange = useRef<boolean>(false);
  const preventedClosing = useRef<boolean>(false);

  if (isFeatureEnabled("bindings") === false) {
    return;
  }
  const valueError = validate?.(evaluateExpressionWithinScope(value, scope));
  return (
    <FloatingPanelPopover
      modal
      open={isOpen}
      onOpenChange={(newOpen) => {
        // handle special case for popover close
        if (newOpen === false) {
          // prevent saving when changes are not saved or validated
          if (hasUnsavedChange.current) {
            // schedule closing after saving
            preventedClosing.current = true;
            return;
          }
          preventedClosing.current = false;
        }
        onOpenChange(newOpen);
      }}
    >
      <FloatingPanelPopoverTrigger asChild ref={triggerRef}>
        <BindingButton variant={variant} error={valueError} value={value} />
      </FloatingPanelPopoverTrigger>
      <FloatingPanelPopoverContent
        sideOffset={sideOffset}
        side="left"
        align="start"
      >
        <BindingPanel
          scope={scope}
          aliases={aliases}
          valueError={valueError}
          value={value}
          onChange={() => {
            hasUnsavedChange.current = true;
          }}
          onSave={(value, invalid) => {
            // avoid saving without changes
            if (hasUnsavedChange.current === false) {
              return;
            }
            // let user see the error and let close popover after
            hasUnsavedChange.current = false;
            if (invalid) {
              return;
            }
            // save value and close popover
            onChange(value);
            if (preventedClosing.current) {
              preventedClosing.current = false;
              onOpenChange(false);
            }
          }}
        />
        {/* put after content to avoid auto focusing heading buttons */}
        <FloatingPanelPopoverTitle
          actions={
            <Tooltip content="Reset binding" side="bottom">
              {/* automatically close popover when remove expression */}
              <FloatingPanelPopoverClose asChild>
                <Button
                  aria-label="Reset binding"
                  prefix={<TrashIcon />}
                  color="ghost"
                  disabled={variant === "default"}
                  onClick={(event) => {
                    event.preventDefault();
                    // inline variables and close dialog
                    const evaluatedValue = evaluateExpressionWithinScope(
                      value,
                      scope
                    );
                    onRemove(evaluatedValue);
                    preventedClosing.current = false;
                    hasUnsavedChange.current = false;
                    onOpenChange(false);
                  }}
                />
              </FloatingPanelPopoverClose>
            </Tooltip>
          }
        >
          Binding
        </FloatingPanelPopoverTitle>
      </FloatingPanelPopoverContent>
    </FloatingPanelPopover>
  );
};
