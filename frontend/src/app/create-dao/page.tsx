"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Circle } from "lucide-react";
import { TokenMintForm } from "@/components/forms/token-mint-form";
import { useDAOCreationStore } from "@/lib/stores/dao-creation-store";
import GovernanceTokenStep from "./_components/governance-token-step";
import { DAOConfigStep } from "./_components/dao-config-step";
import DeployDaoStep from "./_components/deploy-dao-step";
import { TreasuryFundingStep } from "./_components/treasury-funding-step";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type StepStatus = "pending" | "active" | "completed";

interface CreateDAOStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  component?: React.ComponentType<any>;
}

export default function CreateDAOPage() {
  const {
    currentStep,
    setCurrentStep,
    canProceedToStep,
    calculateCurrentStep,
    reset,
  } = useDAOCreationStore();

  const [showClearDialog, setShowClearDialog] = useState(false);

  useEffect(() => {
    const calculatedStep = calculateCurrentStep();
    if (calculatedStep !== currentStep) {
      setCurrentStep(calculatedStep);
    }
  }, []);

  const handleClearProgress = () => {
    reset();
    setShowClearDialog(false);
  };

  const steps = [
    {
      id: "governance-token",
      title: "Set Governance Token",
      description:
        "Create a new token or specify an existing one for DAO governance",
    },
    {
      id: "dao-config",
      title: "Configure DAO Parameters",
      description:
        "Set voting thresholds, proposal timing, and other governance rules",
    },
    {
      id: "deploy",
      title: "Deploy DAO",
      description: "Create the DAO on-chain with your configuration",
    },
    {
      id: "treasury-setup",
      title: "Fund Treasury",
      description: "Fund the initial DAO treasury (optional)",
    },
  ];

  const goToStep = (stepIndex: number) => {
    if (canProceedToStep(stepIndex)) {
      setCurrentStep(stepIndex);
    }
  };

  const getStepStatus = (stepIndex: number) => {
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "active";
    return "pending";
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
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Progress</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowClearDialog(true)}
                className="text-destructive hover:text-destructive"
              >
                Clear
              </Button>
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
                    {getStepIcon(getStepStatus(index), index)}
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
                        variant={getStepBadgeVariant(getStepStatus(index))}
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
                {getStepIcon(getStepStatus(currentStep), currentStep)}
                <CardTitle>{steps[currentStep].title}</CardTitle>
              </div>
              <p className="text-muted-foreground">
                {steps[currentStep].description}
              </p>
            </CardHeader>
            <CardContent>
              {/* Step Content */}
              {currentStep === 0 && (
                <GovernanceTokenStep onComplete={() => goToStep(1)} />
              )}
              {currentStep === 1 && (
                <DAOConfigStep onComplete={() => goToStep(2)} />
              )}
              {currentStep === 2 && <DeployDaoStep />}
              {currentStep === 3 && (
                <TreasuryFundingStep onComplete={() => goToStep(3)} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {showClearDialog && (
        <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear Progress?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all your DAO creation progress and
                start over from the beginning.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearProgress}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Clear Progress
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
