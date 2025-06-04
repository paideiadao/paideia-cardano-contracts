"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, AlertTriangle, CheckCircle } from "lucide-react";
import {
  useDAOCreationStore,
  DAOConfig,
} from "@/lib/stores/dao-creation-store";

interface DAOConfigStepProps {
  onComplete: () => void;
}

interface ValidationError {
  field: string;
  message: string;
}

export function DAOConfigStep({ onComplete }: DAOConfigStepProps) {
  const { setDAOConfig, daoConfig, governanceToken } = useDAOCreationStore();

  const [config, setConfig] = useState<DAOConfig>({
    name: "",
    // description: "", // dao data does not have a description field
    threshold: 60, // From test_dao_datum
    minProposalTime: 40, // 2400 seconds = 40 minutes
    maxProposalTime: 47, // 2800 seconds = 47 minutes
    quorum: 10, // From test_dao_datum
    minGovProposalCreate: 1000, // From test_dao_datum
  });

  const [errors, setErrors] = useState<ValidationError[]>([]);

  // Load existing config if available
  useEffect(() => {
    if (daoConfig) {
      setConfig(daoConfig);
    }
  }, [daoConfig]);

  const validateConfig = (configToValidate: DAOConfig): ValidationError[] => {
    const validationErrors: ValidationError[] = [];

    // Name validation
    if (!configToValidate.name.trim()) {
      validationErrors.push({ field: "name", message: "DAO name is required" });
    } else if (configToValidate.name.length > 50) {
      validationErrors.push({
        field: "name",
        message: "DAO name must be 50 characters or less",
      });
    }

    // Description validation
    // if (!configToValidate.description.trim()) {
    //   validationErrors.push({
    //     field: "description",
    //     message: "Description is required",
    //   });
    // } else if (configToValidate.description.length > 500) {
    //   validationErrors.push({
    //     field: "description",
    //     message: "Description must be 500 characters or less",
    //   });
    // }

    // Threshold validation (contract enforces 1-100)
    if (configToValidate.threshold < 1 || configToValidate.threshold > 100) {
      validationErrors.push({
        field: "threshold",
        message: "Threshold must be between 1% and 100%",
      });
    }

    // Proposal time validation (enforce min < max)
    if (configToValidate.minProposalTime >= configToValidate.maxProposalTime) {
      validationErrors.push({
        field: "minProposalTime",
        message: "Minimum proposal time must be less than maximum",
      });
    }

    // Reasonable time bounds (1 minute to 30 days)
    if (configToValidate.minProposalTime < 1) {
      validationErrors.push({
        field: "minProposalTime",
        message: "Minimum proposal time must be at least 1 minute",
      });
    }
    if (configToValidate.maxProposalTime > 43200) {
      // 30 days in minutes
      validationErrors.push({
        field: "maxProposalTime",
        message: "Maximum proposal time cannot exceed 30 days",
      });
    }

    // Quorum validation (must be positive)
    if (configToValidate.quorum < 1) {
      validationErrors.push({
        field: "quorum",
        message: "Quorum must be at least 1 token",
      });
    }

    // Min governance tokens validation
    if (configToValidate.minGovProposalCreate < 1) {
      validationErrors.push({
        field: "minGovProposalCreate",
        message: "Minimum tokens to create proposal must be at least 1",
      });
    }

    // Logical validation: min proposal creation should be reasonable vs quorum
    if (configToValidate.minGovProposalCreate > configToValidate.quorum * 10) {
      validationErrors.push({
        field: "minGovProposalCreate",
        message:
          "Proposal creation requirement seems too high compared to quorum",
      });
    }

    return validationErrors;
  };

  const handleInputChange = (
    field: keyof DAOConfig,
    value: string | number
  ) => {
    const updatedConfig = { ...config, [field]: value };
    setConfig(updatedConfig);

    // Real-time validation
    const newErrors = validateConfig(updatedConfig);
    setErrors(newErrors);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = validateConfig(config);
    setErrors(validationErrors);

    if (validationErrors.length === 0) {
      setDAOConfig(config);
      onComplete();
    }
  };

  const getFieldError = (field: string) => {
    return errors.find((error) => error.field === field)?.message;
  };

  const hasFieldError = (field: string) => {
    return errors.some((error) => error.field === field);
  };

  const isFormValid = errors.length === 0 && config.name.trim();
  // && config.description.trim();

  // Calculate contract values for display
  const minProposalTimeSeconds = config.minProposalTime * 60;
  const maxProposalTimeSeconds = config.maxProposalTime * 60;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Configure DAO Parameters
            <Info className="h-4 w-4 text-muted-foreground" />
          </CardTitle>
          <CardDescription>
            Set the governance rules that will control how your DAO operates.
            These parameters are immutable once deployed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="mb-6">
            <AccordionItem value="governance-info">
              <AccordionTrigger>How do these parameters work?</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="border-l-4 border-blue-500 pl-4">
                      <h4 className="font-semibold text-blue-700">Threshold</h4>
                      <p className="text-sm text-muted-foreground">
                        Percentage of votes needed for a proposal option to
                        pass. Higher = more consensus required.
                      </p>
                    </div>

                    <div className="border-l-4 border-green-500 pl-4">
                      <h4 className="font-semibold text-green-700">Quorum</h4>
                      <p className="text-sm text-muted-foreground">
                        Minimum total votes required for any proposal to be
                        valid. Prevents decisions with low participation.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="border-l-4 border-purple-500 pl-4">
                      <h4 className="font-semibold text-purple-700">
                        Proposal Duration
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        How long proposals stay open for voting. Longer = more
                        participation, shorter = faster decisions.
                      </p>
                    </div>

                    <div className="border-l-4 border-orange-500 pl-4">
                      <h4 className="font-semibold text-orange-700">
                        Proposal Creation
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Minimum tokens needed to create proposals. Prevents spam
                        while allowing participation.
                      </p>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="security-info">
              <AccordionTrigger>
                What about proposal and action types?
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your DAO will be configured with secure, pre-audited contract
                  types:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 ml-4">
                  <li>
                    • <strong>Standard Proposals</strong> - Text-based
                    governance proposals for community decisions
                  </li>
                  <li>
                    • <strong>Treasury Actions</strong> - Send funds from the
                    DAO treasury to specified addresses
                  </li>
                  <li>
                    • <strong>Future Extensions</strong> - Additional action
                    types can be added through governance
                  </li>
                </ul>
                <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/30 rounded border">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    🔒 Security: Only whitelisted contract types can interact
                    with your treasury, preventing unauthorized access.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Basic Information</h3>

              <div>
                <Label htmlFor="name">DAO Name</Label>
                <Input
                  id="name"
                  value={config.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="My Awesome DAO"
                  className={hasFieldError("name") ? "border-red-500" : ""}
                  maxLength={50}
                />
                {hasFieldError("name") && (
                  <p className="text-sm text-red-600 mt-1">
                    {getFieldError("name")}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  disabled
                  value="Currently the DAO metadata object doesn't contain a description field. Coming in V2"
                  // onChange={(e) =>
                  //   handleInputChange("description", e.target.value)
                  // }
                  placeholder="Describe your DAO's purpose and goals..."
                  className={
                    hasFieldError("description") ? "border-red-500" : ""
                  }
                  maxLength={500}
                  rows={3}
                />
                <div className="flex justify-between mt-1">
                  {hasFieldError("description") && (
                    <p className="text-sm text-red-600">
                      {getFieldError("description")}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground ml-auto">
                    {/* {config.description.length}/500 */}
                    0/500
                  </p>
                </div>
              </div>
            </div>

            {/* Voting Parameters */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Voting Parameters</h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="threshold">
                    Passing Threshold
                    <span className="text-muted-foreground ml-1">(%)</span>
                  </Label>
                  <Input
                    id="threshold"
                    type="number"
                    value={config.threshold}
                    onChange={(e) =>
                      handleInputChange(
                        "threshold",
                        parseInt(e.target.value) || 0
                      )
                    }
                    min={1}
                    max={100}
                    className={
                      hasFieldError("threshold") ? "border-red-500" : ""
                    }
                  />
                  {hasFieldError("threshold") && (
                    <p className="text-sm text-red-600 mt-1">
                      {getFieldError("threshold")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    A proposal option needs {config.threshold}% of votes to pass
                  </p>
                </div>

                <div>
                  <Label htmlFor="quorum">
                    Quorum Requirement
                    <span className="text-muted-foreground ml-1">
                      ({governanceToken?.symbol ?? "tokens"})
                    </span>
                  </Label>
                  <Input
                    id="quorum"
                    type="number"
                    value={config.quorum}
                    onChange={(e) =>
                      handleInputChange("quorum", parseInt(e.target.value) || 0)
                    }
                    min={1}
                    className={hasFieldError("quorum") ? "border-red-500" : ""}
                  />
                  {hasFieldError("quorum") && (
                    <p className="text-sm text-red-600 mt-1">
                      {getFieldError("quorum")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum total votes needed for proposal validity
                  </p>
                </div>
              </div>
            </div>

            {/* Timing Parameters */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Proposal Timing</h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="minProposalTime">
                    Minimum Duration
                    <span className="text-muted-foreground ml-1">
                      (minutes)
                    </span>
                  </Label>
                  <Input
                    id="minProposalTime"
                    type="number"
                    value={config.minProposalTime}
                    onChange={(e) =>
                      handleInputChange(
                        "minProposalTime",
                        parseInt(e.target.value) || 0
                      )
                    }
                    min={1}
                    className={
                      hasFieldError("minProposalTime") ? "border-red-500" : ""
                    }
                  />
                  {hasFieldError("minProposalTime") && (
                    <p className="text-sm text-red-600 mt-1">
                      {getFieldError("minProposalTime")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Contract value: {minProposalTimeSeconds} seconds
                  </p>
                </div>

                <div>
                  <Label htmlFor="maxProposalTime">
                    Maximum Duration
                    <span className="text-muted-foreground ml-1">
                      (minutes)
                    </span>
                  </Label>
                  <Input
                    id="maxProposalTime"
                    type="number"
                    value={config.maxProposalTime}
                    onChange={(e) =>
                      handleInputChange(
                        "maxProposalTime",
                        parseInt(e.target.value) || 0
                      )
                    }
                    min={1}
                    className={
                      hasFieldError("maxProposalTime") ? "border-red-500" : ""
                    }
                  />
                  {hasFieldError("maxProposalTime") && (
                    <p className="text-sm text-red-600 mt-1">
                      {getFieldError("maxProposalTime")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Contract value: {maxProposalTimeSeconds} seconds
                  </p>
                </div>
              </div>
            </div>

            {/* Participation Requirements */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">
                Participation Requirements
              </h3>

              <div>
                <Label htmlFor="minGovProposalCreate">
                  Minimum Tokens to Create Proposal
                  <span className="text-muted-foreground ml-1">
                    ({governanceToken?.symbol ?? "tokens"})
                  </span>
                </Label>
                <Input
                  id="minGovProposalCreate"
                  type="number"
                  value={config.minGovProposalCreate}
                  onChange={(e) =>
                    handleInputChange(
                      "minGovProposalCreate",
                      parseInt(e.target.value) || 0
                    )
                  }
                  min={1}
                  className={
                    hasFieldError("minGovProposalCreate")
                      ? "border-red-500"
                      : ""
                  }
                />
                {hasFieldError("minGovProposalCreate") && (
                  <p className="text-sm text-red-600 mt-1">
                    {getFieldError("minGovProposalCreate")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Prevents proposal spam while allowing community participation
                </p>
              </div>
            </div>

            {/* Validation Summary */}
            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p className="font-medium">
                      Please fix the following issues:
                    </p>
                    <ul className="text-sm space-y-1 ml-4">
                      {errors.map((error, index) => (
                        <li key={index}>• {error.message}</li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {isFormValid && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Configuration looks good! These parameters will be immutable
                  once your DAO is deployed.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between pt-4">
              <Button type="button" variant="outline">
                Back to Token Selection
              </Button>
              <Button type="submit" disabled={!isFormValid}>
                Continue to Deployment
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
