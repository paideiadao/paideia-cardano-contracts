"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Circle } from "lucide-react";
import { TokenMintForm } from "@/components/forms/token-mint-form";

type StepStatus = "pending" | "active" | "completed";

interface CreateDAOStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  component?: React.ComponentType<any>;
}

export default function CreateDAOPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<CreateDAOStep[]>([
    {
      id: "governance-token",
      title: "Set Governance Token",
      description:
        "Create a new token or specify an existing one for DAO governance",
      status: "active",
    },
    {
      id: "dao-config",
      title: "Configure DAO Parameters",
      description:
        "Set voting thresholds, proposal timing, and other governance rules",
      status: "pending",
    },
    {
      id: "treasury-setup",
      title: "Initialize Treasury",
      description: "Fund the initial DAO treasury (optional)",
      status: "pending",
    },
    {
      id: "deploy",
      title: "Deploy DAO",
      description: "Create the DAO on-chain with your configuration",
      status: "pending",
    },
  ]);

  const updateStepStatus = (stepIndex: number, status: StepStatus) => {
    setSteps((prev) =>
      prev.map((step, index) =>
        index === stepIndex ? { ...step, status } : step
      )
    );
  };

  const proceedToNextStep = () => {
    if (currentStep < steps.length - 1) {
      updateStepStatus(currentStep, "completed");
      updateStepStatus(currentStep + 1, "active");
      setCurrentStep(currentStep + 1);
    }
  };

  const goToStep = (stepIndex: number) => {
    // Only allow going to completed steps or the next pending step
    const canNavigate =
      stepIndex <= currentStep ||
      (stepIndex === currentStep + 1 &&
        steps[currentStep].status === "completed");

    if (canNavigate) {
      setCurrentStep(stepIndex);
      if (steps[stepIndex].status === "pending") {
        updateStepStatus(stepIndex, "active");
      }
    }
  };

  const getStepIcon = (status: StepStatus, stepIndex: number) => {
    switch (status) {
      case "completed":
        return <Check className="h-5 w-5 text-green-600" />;
      case "active":
        return <Clock className="h-5 w-5 text-blue-600" />;
      default:
        return <Circle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStepBadgeVariant = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return "default" as const;
      case "active":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Create Your DAO</h1>
        <p className="text-muted-foreground">
          Follow these steps to set up your decentralized autonomous
          organization
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Timeline Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    index === currentStep
                      ? "bg-blue-50 dark:bg-blue-950/30"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                  onClick={() => goToStep(index)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {getStepIcon(step.status, index)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3
                        className={`font-medium text-sm ${
                          index === currentStep
                            ? "text-blue-700 dark:text-blue-300"
                            : ""
                        }`}
                      >
                        {step.title}
                      </h3>
                      <Badge
                        variant={getStepBadgeVariant(step.status)}
                        className="text-xs"
                      >
                        {index + 1}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                {getStepIcon(steps[currentStep].status, currentStep)}
                <CardTitle>{steps[currentStep].title}</CardTitle>
              </div>
              <p className="text-muted-foreground">
                {steps[currentStep].description}
              </p>
            </CardHeader>
            <CardContent>
              {/* Step Content */}
              {currentStep === 0 && (
                <GovernanceTokenStep onComplete={proceedToNextStep} />
              )}
              {currentStep === 1 && (
                <DAOConfigStep onComplete={proceedToNextStep} />
              )}
              {currentStep === 2 && (
                <TreasurySetupStep onComplete={proceedToNextStep} />
              )}
              {currentStep === 3 && <DeployStep />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Placeholder components for each step
function GovernanceTokenStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <TokenMintForm />

      <div className="flex justify-end">
        <Button onClick={onComplete}>Continue to DAO Configuration</Button>
      </div>
    </div>
  );
}

function DAOConfigStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
        <p className="text-muted-foreground">
          DAO configuration form coming next...
        </p>
      </div>

      <div className="flex justify-between">
        <Button variant="outline">Back</Button>
        <Button onClick={onComplete}>Continue to Treasury Setup</Button>
      </div>
    </div>
  );
}

function TreasurySetupStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
        <p className="text-muted-foreground">
          Treasury setup form coming next...
        </p>
      </div>

      <div className="flex justify-between">
        <Button variant="outline">Back</Button>
        <Button onClick={onComplete}>Continue to Deploy</Button>
      </div>
    </div>
  );
}

function DeployStep() {
  return (
    <div className="space-y-6">
      <div className="text-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
        <p className="text-muted-foreground">
          Deployment interface coming next...
        </p>
      </div>

      <div className="flex justify-between">
        <Button variant="outline">Back</Button>
        <Button>Deploy DAO</Button>
      </div>
    </div>
  );
}
